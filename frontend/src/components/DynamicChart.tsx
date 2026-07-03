/* eslint-disable */
import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import type { ChartData } from '../types/chat';

interface DynamicChartProps {
  data: ChartData[];
  type?: 'bar' | 'line';
}

const DynamicChart: React.FC<DynamicChartProps> = ({ data, type = 'bar' }) => {
  if (!data || !Array.isArray(data) || data.length === 0 || !data[0]) return null;

  // Extract all keys except 'name' to use as data series
  const dataKeys = Object.keys(data[0] || {}).filter((key) => key !== 'name');
  if (dataKeys.length === 0) return null;
  
  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444'];

  const formatFinancialValue = (value: number | string) => {
    if (typeof value !== 'number') {
      const num = Number(value);
      if (isNaN(num)) return value;
      value = num;
    }
    const absValue = Math.abs(value);
    if (absValue >= 1e12) {
      return `${(value / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 })} T`;
    }
    if (absValue >= 1e9) {
      return `${(value / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })} B`;
    }
    if (absValue >= 1e6) {
      return `${(value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })} M`;
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const renderChart = () => {
    if (type === 'line') {
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis 
            dataKey="name" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: '#94A3B8', fontSize: 12 }} 
            dy={10}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: '#94A3B8', fontSize: 12 }} 
            tickFormatter={formatFinancialValue}
          />
          <Tooltip 
            formatter={(value: any) => [formatFinancialValue(value)]}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
          />
          <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
          {dataKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[index % colors.length]}
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      );
    }

    return (
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis 
          dataKey="name" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94A3B8', fontSize: 12 }} 
          dy={10}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94A3B8', fontSize: 12 }} 
          tickFormatter={formatFinancialValue}
        />
        <Tooltip 
          cursor={{ fill: '#F8FAFC' }}
          formatter={(value: any) => [formatFinancialValue(value)]}
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
        />
        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
        {dataKeys.map((key, index) => (
          <Bar 
            key={key} 
            dataKey={key} 
            fill={colors[index % colors.length]} 
            radius={[4, 4, 0, 0]} 
            barSize={40}
          />
        ))}
      </BarChart>
    );
  };

  return (
    <div className="w-full h-80 mt-4 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
      <ResponsiveContainer width="99%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
};

export default DynamicChart;
