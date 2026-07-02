import pytest
import numpy as np

# Simple parser helper functions to mock structural OCR layout calculations
def calculate_ocr_confidence(words: list) -> dict:
    # TC-ADV-BE-05: Analyze low DPI artifacts / character errors
    confidences = [w.get("confidence", 1.0) for w in words]
    mean_conf = np.mean(confidences) if confidences else 1.0
    return {
        "text": " ".join([w["text"] for w in words]),
        "confidence": mean_conf,
        "warning_flag": mean_conf < 0.85
    }

def handle_handwritten_overlapping(grid_words: list) -> dict:
    # TC-ADV-BE-06: Check handwriting overlapping typed grids
    overlapped = False
    clean_texts = []
    for w in grid_words:
        if w.get("metadata", {}).get("overlapping_stroke", False):
            overlapped = True
            # Rely on high confidence or primary print layer
            clean_texts.append(w.get("printed_text", w["text"]))
        else:
            clean_texts.append(w["text"])
    return {
        "text": " ".join(clean_texts),
        "ambiguous": overlapped
    }

def process_nested_table_coordinates(cells: list) -> list:
    # TC-ADV-BE-07: Standardize table grids keeping hierarchical sub-cells grouped
    cells.sort(key=lambda c: (c["row_idx"], c["col_idx"], c.get("sub_row_idx", 0)))
    return cells

def reconstruct_columns_without_vertical_lines(blocks: list, x_threshold=15.0) -> list:
    # TC-ADV-BE-08: Recover separate columns from broken gridlines via X distance clustering
    blocks.sort(key=lambda b: b["x0"])
    columns = []
    current_col = []
    for b in blocks:
        if not current_col:
            current_col.append(b)
        else:
            # If distance on X axis is large, treat as separate column
            if b["x0"] - current_col[-1]["x1"] > x_threshold:
                columns.append(current_col)
                current_col = [b]
            else:
                current_col.append(b)
    if current_col:
        columns.append(current_col)
    return columns

def determine_ocr_activation_by_page_density(page_text: str) -> bool:
    # TC-ADV-BE-09: Trigger OCR selectively based on character density per page
    # Strip spaces
    clean_text = "".join(page_text.split())
    return len(clean_text) < 50

def align_blank_columns(row_cells: list) -> dict:
    # TC-ADV-BE-10: Guard against overflow spillover on blank column boundaries
    aligned = {}
    for cell in row_cells:
        col_x_start = cell["col_x0"]
        col_x_end = cell["col_x1"]
        # If cell text x-coord exceeds column bounding box, truncate or wrap
        text_x0 = cell.get("text_x0", col_x_start)
        if text_x0 > col_x_end:
            # Spillover detected -> Map to next column instead
            target_col = cell["col_idx"] + 1
        else:
            target_col = cell["col_idx"]
        aligned[target_col] = cell["text"]
    return aligned


# Unit tests
def test_tc_adv_be_05_low_dpi_artifact_warning():
    words = [
        {"text": "Doanh", "confidence": 0.99},
        {"text": "thu", "confidence": 0.98},
        {"text": "8.000.000", "confidence": 0.50} # Low confidence number
    ]
    res = calculate_ocr_confidence(words)
    assert bool(res["warning_flag"]) is True
    assert "8.000.000" in res["text"]

def test_tc_adv_be_06_handwritten_annotations():
    grid = [
        {"text": "12.000", "printed_text": "12.000", "confidence": 0.95},
        {"text": "14.500", "printed_text": "12.000", "confidence": 0.50, "metadata": {"overlapping_stroke": True}}
    ]
    res = handle_handwritten_overlapping(grid)
    assert res["ambiguous"] is True

def test_tc_adv_be_07_nested_layered_tables():
    cells = [
        {"row_idx": 0, "col_idx": 0, "text": "Doanh thu", "sub_row_idx": 0},
        {"row_idx": 0, "col_idx": 1, "text": "Hàng gia dụng", "sub_row_idx": 1},
        {"row_idx": 0, "col_idx": 1, "text": "Hàng điện tử", "sub_row_idx": 0}
    ]
    processed = process_nested_table_coordinates(cells)
    # Assert electrical goods (sub_row_idx=0) comes before household goods (sub_row_idx=1)
    assert processed[1]["text"] == "Hàng điện tử"
    assert processed[2]["text"] == "Hàng gia dụng"

def test_tc_adv_be_08_broken_gridlines_column_separation():
    blocks = [
        {"text": "Doanh thu 2024", "x0": 100, "x1": 200},
        {"text": "Doanh thu 2025", "x0": 250, "x1": 350}
    ]
    cols = reconstruct_columns_without_vertical_lines(blocks)
    assert len(cols) == 2
    assert cols[0][0]["text"] == "Doanh thu 2024"
    assert cols[1][0]["text"] == "Doanh thu 2025"

def test_tc_adv_be_09_hybrid_pdf_ocr_activation():
    digital_page = "Đây là trang báo cáo tài chính rất dài có đầy đủ các thông tin chi tiết bằng định dạng văn bản gốc."
    scanned_page = "   " # Low characters density
    assert determine_ocr_activation_by_page_density(digital_page) is False
    assert determine_ocr_activation_by_page_density(scanned_page) is True

def test_tc_adv_be_10_blank_column_spillover():
    cells = [
        {"col_idx": 0, "col_x0": 10, "col_x1": 50, "text_x0": 12, "text": "Chi phí phát sinh"},
        {"col_idx": 1, "col_x0": 60, "col_x1": 100, "text_x0": 110, "text": "Nội dung tràn lề sang cột kế tiếp"}
    ]
    aligned = align_blank_columns(cells)
    assert 2 in aligned # Spillover correctly mapped
