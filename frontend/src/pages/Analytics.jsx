import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { apiUrl } from '../api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        setLoading(true);
        setError(null);

        // Get session for token authentication
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('No active user session found.');
        }

        const response = await fetch(apiUrl('/analytics/deflection-rate'), {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || 'Failed to fetch deflection rate data.');
        }

        const resData = await response.json();
        setData(resData);
      } catch (err) {
        console.error('Error loading analytics:', err);
        setError(err.message || 'An error occurred while loading analytics.');
      } finally {
        setLoading(false);
      }
    }

    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '60vh',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-family)'
      }}>
        Loading Analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 'var(--space-md)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid var(--accent-danger)',
        color: 'var(--accent-danger)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--font-size-sm)',
        fontFamily: 'var(--font-family)',
        margin: 'var(--space-lg) 0'
      }}>
        {error}
      </div>
    );
  }

  const chartData = [
    { name: 'AI Resolved', value: data?.ai_resolved || 0 },
    { name: 'Human Resolved', value: data?.human_resolved || 0 }
  ];

  const colors = ['var(--accent-success)', 'var(--accent-primary)'];

  return (
    <div style={{ color: 'var(--text)' }}>
      <h1 className="page-title" style={{ marginBottom: '24px' }}>Analytics Dashboard</h1>

      {/* Stats Grid */}
      <div className="analytics-grid">
        {/* Deflection Rate Card */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '140px'
        }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
            Deflection Rate
          </span>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--accent-success)', margin: 'var(--space-sm) 0' }}>
            {data?.deflection_rate}%
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Percentage of tickets resolved by AI
          </span>
        </div>

        {/* Total Tickets Card */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '140px'
        }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
            Total Tickets
          </span>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--text-primary)', margin: 'var(--space-sm) 0' }}>
            {data?.total_tickets}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            All incoming customer requests
          </span>
        </div>

        {/* AI Resolved Card */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '140px'
        }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
            AI Resolved
          </span>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--accent-success)', margin: 'var(--space-sm) 0' }}>
            {data?.ai_resolved}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Tickets solved automatically by AI
          </span>
        </div>

        {/* Human Ever Card */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '140px'
        }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
            Human Ever (HITL)
          </span>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--accent-warning)', margin: 'var(--space-sm) 0' }}>
            {data?.hitl_ever}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Tickets routed to human review
          </span>
        </div>
      </div>

      {/* Visualizations Panel */}
      <div className="charts-grid">
        {/* Bar Chart comparing AI vs Human */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)'
        }}>
          <h3 style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-lg)' }}>
            Resolution Breakdown (Bar Chart)
          </h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
                <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)'
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  <Cell fill="var(--accent-success)" />
                  <Cell fill="var(--accent-primary)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut Chart comparing AI vs Human */}
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-card)'
        }}>
          <h3 style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-lg)' }}>
            Resolution Share (Donut Chart)
          </h3>
          <div style={{ width: '100%', height: 260, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)'
                  }}
                />
                <Legend 
                  formatter={(value) => <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
