-- 1. Create Custom ENUM Types
CREATE TYPE public.ticket_status AS ENUM ('open', 'pending', 'hitl', 'resolved');
CREATE TYPE public.message_sender AS ENUM ('customer', 'agent', 'ai');
CREATE TYPE public.sync_status_type AS ENUM ('pending', 'synced', 'delete_pending');

-- 2. Create tickets Table
CREATE TABLE public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    status public.ticket_status NOT NULL DEFAULT 'open',
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create ticket_messages Table
CREATE TABLE public.ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    sender public.message_sender NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create kb_articles Table
CREATE TABLE public.kb_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    sync_status public.sync_status_type NOT NULL DEFAULT 'pending',
    embedding_model_version TEXT,
    previous_version_id UUID REFERENCES public.kb_articles(id) ON DELETE SET NULL,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Auto-Update updated_at Trigger for tickets
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_ticket_updated
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

-- Helper Function to securely get current user's role from user_roles
CREATE OR REPLACE FUNCTION public.get_auth_role() 
RETURNS public.user_role AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 7. RLS Policies: tickets
-- Admins can do everything
CREATE POLICY "Admins can manage all tickets" 
ON public.tickets FOR ALL 
USING (public.get_auth_role() = 'admin');

-- Agents can only view/update tickets assigned to them
CREATE POLICY "Agents can view assigned tickets" 
ON public.tickets FOR SELECT 
USING (public.get_auth_role() = 'agent' AND assigned_to = auth.uid());

CREATE POLICY "Agents can update assigned tickets" 
ON public.tickets FOR UPDATE 
USING (public.get_auth_role() = 'agent' AND assigned_to = auth.uid());

CREATE POLICY "Agents can insert tickets" 
ON public.tickets FOR INSERT 
WITH CHECK (public.get_auth_role() = 'agent');


-- 8. RLS Policies: ticket_messages
-- Admins can do everything
CREATE POLICY "Admins can manage all messages" 
ON public.ticket_messages FOR ALL 
USING (public.get_auth_role() = 'admin');

-- Agents inherit access based on parent ticket assignment
CREATE POLICY "Agents can view messages for assigned tickets" 
ON public.ticket_messages FOR SELECT 
USING (
    public.get_auth_role() = 'agent' AND 
    EXISTS (SELECT 1 FROM public.tickets WHERE id = ticket_messages.ticket_id AND assigned_to = auth.uid())
);

CREATE POLICY "Agents can insert messages for assigned tickets" 
ON public.ticket_messages FOR INSERT 
WITH CHECK (
    public.get_auth_role() = 'agent' AND 
    EXISTS (SELECT 1 FROM public.tickets WHERE id = ticket_messages.ticket_id AND assigned_to = auth.uid())
);


-- 9. RLS Policies: kb_articles
-- Visible to all authenticated users (agents & admins)
CREATE POLICY "Authenticated users can view kb_articles" 
ON public.kb_articles FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert/update kb_articles" 
ON public.kb_articles FOR ALL 
USING (auth.role() = 'authenticated');


-- 10. Auto-assign tickets to a random agent if assigned_to is NULL
CREATE OR REPLACE FUNCTION public.auto_assign_ticket()
RETURNS TRIGGER AS $$
DECLARE
    random_agent_id UUID;
BEGIN
    IF NEW.assigned_to IS NULL THEN
        -- Select a random agent from user_roles
        SELECT user_id INTO random_agent_id
        FROM public.user_roles
        WHERE role = 'agent'
        ORDER BY random()
        LIMIT 1;

        IF random_agent_id IS NOT NULL THEN
            NEW.assigned_to := random_agent_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_ticket_inserted_assign
    BEFORE INSERT ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.auto_assign_ticket();
