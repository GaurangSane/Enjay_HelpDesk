import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AdminProtectedRoute from './components/AdminProtectedRoute';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import PendingApproval from './pages/PendingApproval';
import DashboardLayout from './components/DashboardLayout';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import KnowledgeBase from './pages/KnowledgeBase';
import Analytics from './pages/Analytics';
import AdminApprovals from './pages/AdminApprovals';

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />

        {/* Authenticated-but-pending route — no ProtectedRoute wrapper so it renders freely */}
        <Route path="/pending-approval" element={<PendingApproval />} />

        {/* Protected dashboard routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/tickets/open" replace />} />
          <Route path="tickets/open" element={<Tickets status="open" />} />
          <Route path="tickets/pending" element={<Tickets status="pending" />} />
          <Route path="tickets/hitl" element={<Tickets status="hitl" />} />
          <Route path="tickets/ai_resolved" element={<Tickets status="ai_resolved" />} />
          <Route path="tickets/resolved" element={<Tickets status="resolved" />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route
            path="analytics"
            element={
              <AdminProtectedRoute>
                <Analytics />
              </AdminProtectedRoute>
            }
          />
          <Route
            path="admin/approvals"
            element={
              <AdminProtectedRoute>
                <AdminApprovals />
              </AdminProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </Router>
  );
}
