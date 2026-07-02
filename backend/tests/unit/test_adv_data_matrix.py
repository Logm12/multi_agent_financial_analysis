import pandas as pd
import numpy as np
import re

# Helper normalization algorithm to resolve mixed notations and clean notes (Poka-Yoke implementation)
def clean_numeric_value(val_str: str) -> float:
    if pd.isna(val_str) or not isinstance(val_str, str):
        return np.nan
    s = val_str.strip()
    if not s:
        return np.nan

    # TC-ADV-BE-03: Convert negative formats (parenthesized or trailing minus)
    s = re.sub(r'^\((.*)\)$', r'-\1', s)
    if s.endswith('-') and len(s) > 1:
        s = '-' + s[:-1]

    # TC-ADV-BE-04: Parse inline text notes - extract numeric candidate first
    match = re.search(r'-?[\d\.,]+', s)
    if not match:
        return np.nan
    s_num = match.group(0)

    # TC-ADV-BE-02: Handle mixed notation (IFRS: 1,250,000.50 vs VAS: 1.250.000,50)
    if '.' in s_num and ',' in s_num:
        if s_num.rfind('.') > s_num.rfind(','):
            # dot is decimal (IFRS)
            s_num = s_num.replace(',', '')
        else:
            # comma is decimal (VAS)
            s_num = s_num.replace('.', '').replace(',', '.')
    elif ',' in s_num:
        # Check if the comma acts as decimal or thousands separator
        parts = s_num.split(',')
        if len(parts) == 2 and len(parts[1]) <= 2:
            s_num = s_num.replace(',', '.')
        else:
            s_num = s_num.replace(',', '')
    elif '.' in s_num:
        parts = s_num.split('.')
        # If multiple dots or single dot with 3 trailing digits for thousands:
        if len(parts) > 2:
            s_num = s_num.replace('.', '')
        elif len(parts) == 2 and len(parts[1]) == 3:
            # Ambiguous: could be 1.000 (thousand) or 1.000 (decimal 1.0)
            # Default to thousands representation for integer financial figures
            s_num = s_num.replace('.', '')
            
    try:
        return float(s_num)
    except ValueError:
        return np.nan

def test_tc_adv_be_01_asymmetric_table_alignment():
    """TC-ADV-BE-01: Verify merging table fragments across pages preserves year mapping."""
    # Simulation: Columns split across pages/scans
    page14_data = pd.DataFrame({
        "Row_Header": ["Revenue", "Net Profit", "Total Assets"],
        "End_Year_2024": ["120.000.000", "15.000.000", "500.000.000"]
    })
    page15_data = pd.DataFrame({
        "Row_Header": ["Revenue", "Net Profit", "Total Assets"],
        "Start_Year_2023": ["100.000.000", "12.000.000", "450.000.000"]
    })
    
    # Outer join on row header guarantees alignment
    merged = pd.merge(page14_data, page15_data, on="Row_Header", how="outer")
    
    # Assert alignment by key lookup
    assert "Revenue" in list(merged["Row_Header"])
    assert "Net Profit" in list(merged["Row_Header"])
    assert "Total Assets" in list(merged["Row_Header"])
    assert merged.loc[merged["Row_Header"] == "Net Profit", "End_Year_2024"].values[0] == "15.000.000"
    assert merged.loc[merged["Row_Header"] == "Net Profit", "Start_Year_2023"].values[0] == "12.000.000"


def test_tc_adv_be_02_vas_to_ifrs_mixed_notation():
    """TC-ADV-BE-02: Verify parser normalizes mixed separators (dots & commas) without magnification."""
    test_cases = [
        ("1.250.000,50", 1250000.5),  # VAS format
        ("1,250,000.50", 1250000.5),  # IFRS format
        ("1250000", 1250000.0)
    ]
    for val, expected in test_cases:
        assert clean_numeric_value(val) == expected


def test_tc_adv_be_03_complex_negative_values():
    """TC-ADV-BE-03: Verify parsing negative figures formats from various string patterns."""
    test_cases = [
        ("(1.500.000)", -1500000.0),
        ("-1.500.000", -1500000.0),
        ("1.500.000-", -1500000.0)
    ]
    for val, expected in test_cases:
        assert clean_numeric_value(val) == expected


def test_tc_adv_be_04_inline_text_pollution():
    """TC-ADV-BE-04: Verify text comments/notes in numeric cells do not trigger parsing failure."""
    raw_val = "15.400.000 (đã trừ dự phòng)"
    expected = 15400000.0
    assert clean_numeric_value(raw_val) == expected
