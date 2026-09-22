import React, { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import {
  Sparkles, Mic, FileText, Keyboard, LayoutDashboard, Send,
  TrendingUp, DollarSign, ShieldAlert, Award, FileSpreadsheet,
  ArrowRight, User, Settings, CheckCircle2, ChevronRight,
  Play, RefreshCw, X, AlertTriangle, AlertCircle, Check,
  Volume2, ShieldCheck, Landmark, Briefcase, FileInput,
  Calendar, Layers, Clock, Users, ArrowUpRight, ArrowDownRight, Menu,
  Paperclip, MessageSquare, History, Search, Eye, Filter,
  Truck, Package, Receipt, CreditCard, Moon, Sun, Bell,
  PanelLeftClose,
  Building2, Timer, Zap, Star, Activity, Boxes, Handshake, ScanLine,
  LayoutGrid, List as ListIcon, Gavel
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DEFAULT_API_URL, OFFLINE_TOKEN, resolveApiUrl, resolveDemoUser,
} from './demoMode';
import { AuctionDesk, VendorAuctions } from './auction';
import type { AuctionableRequest } from './auction';

// Define the Scene IDs and names
const SCENES = [
  { id: 1, name: "Scene 1: Login & Portal Selector" },
  { id: 2, name: "Scene 2: Employee Portal (Consolidated Chat & Tabs)" },
  { id: 3, name: "Scene 3: Voice Assistant Simulation" },
  { id: 4, name: "Scene 4: AI Requisition Extraction Form" },
  { id: 5, name: "Scene 5: Active Rate Contract Search" },
  { id: 6, name: "Scene 6: SCM Sourcing & External Sourcing Bids" },
  { id: 7, name: "Scene 7: RFQ Value Scorecard" },
  { id: 8, name: "Scene 8: AI Autonomous Negotiation Lounge" },
  { id: 9, name: "Scene 9: Smart Budget Verification & Allocation" },
  { id: 10, name: "Scene 10: Manager Approval Dashboard" },
  { id: 11, name: "Scene 11: Request Tracking Timeline" },
  { id: 12, name: "Scene 12: Product Receiving & Inspection (GRN)" },
  { id: 13, name: "Scene 13: Vendor Bill 3-Way Matching" },
  { id: 14, name: "Scene 14: Payment Processing & Reconciliation" },
  { id: 15, name: "Scene 15: Spend Intelligence Analytics" },
  { id: 16, name: "Scene 16: Master Data Console" },
  { id: 17, name: "Scene 17: Questions Raised" },
  { id: 18, name: "Scene 18: Vendor Portal" },
  { id: 19, name: "Scene 19: Live Reverse Auctions" }
];

/** The signed-in Odoo user, as returned by /api/smartspend/login. */
interface OdooUser {
  id: number;
  name: string;
  login: string;
  email?: string;
  is_manager?: boolean;
  is_buyer?: boolean;
  /** An external supplier account — quotes on RFQs, holds no staff role. */
  is_vendor?: boolean;
  /** Roles this account may act as — from its Odoo groups, not a free choice. */
  roles?: string[];
  defaultRole?: string;
  company?: string;
}

/** Master data served by Odoo, replacing the lists this app used to hardcode. */
interface MasterData {
  branches: { id: number; name: string; code: string; city: string }[];
  departments: { id: number; name: string; code: string; approver: string }[];
  categories: { id: number; name: string; expenseType: string }[];
  urgencies: string[];
  sourcingMethods: string[];
  statuses: string[];
  /** The configured approval matrix. Absent when talking to an older backend. */
  workflows?: ConfiguredWorkflow[];
}

/**
 * One row of the approval matrix an administrator maintains in Odoo: the
 * criteria a request must meet, and the designations that then have to sign it
 * in order.
 */
interface ConfiguredWorkflow {
  id: number;
  name: string;
  document: string;
  workflowType: string;
  branch: string;
  department: string;
  category: string;
  expenseType: string;
  amountFrom: number;
  amountTo: number;
  approvers: { order: number; designation: string; branch: string; department: string }[];
}

/**
 * The designations a workflow level can be assigned to — the same five the Odoo
 * module seeds, so a workflow built here names holders that actually exist.
 */
const DESIGNATIONS = [
  'Reporting Manager', 'Department Head', 'Finance OpEx Head',
  'Finance CapEx Head', 'Chief Financial Officer',
];

/** The lists the portal falls back to when Odoo cannot be reached. */
const FALLBACK_BRANCHES = ['Bangalore Office', 'Kochi Head Office', 'Mumbai Office', 'Delhi Office', 'Chennai Office', 'Hyderabad Office'];
const FALLBACK_DEPARTMENTS = ['IT & Infrastructure', 'Operations', 'Facilities', 'Marketing', 'Finance', 'R&D'];
const FALLBACK_CATEGORIES = ['IT Hardware & Laptops', 'Datacenter Equipment', 'Software Licenses', 'Office Furniture', 'Professional Services', 'MRO Supplies'];
const FALLBACK_EXPENSE_TYPES = ['Capital Expenditure (CapEx)', 'Operating Expenditure (OpEx)'];

/**
 * The group's operating companies.
 *
 * A branch belongs to exactly one of them, so a request's company follows the
 * branch it was raised for — the requester never has to pick one, and the
 * GSTIN on its purchase order and goods receipt is the registration that
 * actually applies to that spend.
 *
 * `branches` names the branches each company owns; anything unlisted falls to
 * the first company, which is the group's registered head entity.
 */
interface Company {
  name: string;
  short: string;
  gstin: string;
  cin: string;
  state: string;
  branches: string[];
}

const COMPANIES: Company[] = [
  {
    name: 'SmartSpend Technologies Pvt Ltd', short: 'SmartSpend Technologies',
    gstin: '29AASCS1234F1Z7', cin: 'U72200KA2019PTC121845', state: 'Karnataka',
    branches: ['Bangalore Office', 'Bangalore Warehouse', 'Hyderabad Office'],
  },
  {
    name: 'SmartSpend Infra Pvt Ltd', short: 'SmartSpend Infra',
    gstin: '32AASCS5678G1Z3', cin: 'U45200KL2020PTC063114', state: 'Kerala',
    branches: ['Kochi Head Office'],
  },
  {
    name: 'SmartSpend Retail Pvt Ltd', short: 'SmartSpend Retail',
    gstin: '27AASCS9012H1Z8', cin: 'U52100MH2021PTC358902', state: 'Maharashtra',
    branches: ['Mumbai Office', 'Delhi Office', 'Chennai Office'],
  },
];

/** The company a branch belongs to. Unknown branches roll up to the head entity. */
const companyForBranch = (branch?: string): Company => {
  const wanted = (branch || '').trim().toLowerCase();
  return COMPANIES.find(c => c.branches.some(b => b.toLowerCase() === wanted)) ?? COMPANIES[0];
};

/**
 * What a supplier sees. Not the buyer's sourcing desk, which is where the
 * vendor account used to land: the orders placed with them, what has been
 * delivered against those orders, and the ones still waiting on their word.
 */
const VENDOR_TABS = [
  { key: 'orders' as const,    label: 'Purchase Orders', icon: Package },
  { key: 'receipts' as const,  label: 'Receipts',        icon: Truck },
  { key: 'approvals' as const, label: 'Approvals',       icon: CheckCircle2 },
  // Reverse auctions the supplier was invited to — see src/auction.tsx.
  { key: 'auctions' as const,  label: 'Live Auctions',   icon: Gavel },
];

/** Every role the demo can show, with the label the switcher renders. */
const ROLE_LABELS: Record<string, string> = {
  'Employee': 'Employee (Requester)',
  'Manager': 'Manager (Approver)',
  'SCM Buyer': 'SCM Buyer (Sourcing)',
  'Vendor': 'Vendor (External Portal)',
  'CEO': 'CEO (Spend Intel)',
};

// The sign-in gate lives on the landing screen (scene 1) itself now: one
// branded screen that takes an email and password, instead of a separate
// plain form followed by a role-portal picker.

interface ChatMessage {
  sender: 'ai' | 'vendor';
  text: string;
  timestamp: string;
}

interface LineItem {
  productName: string;
  productQty: number;
  targetPrice: number;
}

/** One signature the configured workflow demands, and whether it has been given. */
interface ApprovalStep {
  order: number;
  designation: string;
  state: 'pending' | 'approved' | 'rejected';
  decidedBy: string;
  decidedOn: string;
  note: string;
  /** Who holds this designation — the account to sign in as to clear the step. */
  holders?: { name: string; login: string }[];
}

interface RequestItem {
  id: string;
  productName: string;
  productQty: number;
  targetPrice: number;
  totalCost: number;
  location: string;
  department: string;
  expenseCategory: string;
  status: 'Draft' | 'Pending Approval' | 'Needs Clarification' | 'Sourcing' | 'Approved' | 'PO Confirmed' | 'Rejected' | 'Paid';
  urgency: 'High' | 'Medium' | 'Low';
  createdDate: string;
  /** ISO timestamp behind `createdDate`, used to order queues newest-first. */
  submittedAt?: string;
  /** Reference of the approval workflow matched when this was submitted. */
  workflow?: string;
  /** Order number of the step it is waiting on; 0 once the chain is finished. */
  approvalLevel?: number;
  approvalDone?: number;
  approvalTotal?: number;
  /** The chain itself, in signing order. Absent on an older backend. */
  approvalChain?: ApprovalStep[];
  deliveryDate?: string;
  buyer: string;
  vendor: string;
  savings: number;
  history: Array<{ title: string; date: string; desc?: string }>;
  clarificationComments: Array<{ role: 'manager' | 'employee'; text: string; date: string }>;
  vendorBids: Array<{ vendorName: string; price: number; leadTime: string; warranty: string; status: string }>;
  selectedSourcingMethod: 'Negotiation' | 'Multi RFQ' | 'Bidding';
  attachments: string[];
  lineItems?: LineItem[];
  /** References of the Odoo purchase orders raised for this request. */
  purchaseOrders?: string[];
  /** The purchase head has released the order to the vendor. */
  poReleased?: boolean;
  /** The vendor has confirmed the released order. */
  poAcknowledged?: boolean;
  /** Rate contract Odoo matched to this request, and its vendor. */
  contract?: string;
  contractVendor?: string;
  /** Budget Odoo checked it against. */
  budgetName?: string;
  budgetAvailable?: number;
  budgetBreach?: boolean;
  expenseType?: string;
}

// Catalog price book — contract rate, opening vendor bid, AI negotiation target (per unit).
const PRICE_BOOK: Array<{ re: RegExp; contract: number; baseline: number; target: number }> = [
  { re: /dock/i, contract: 8500, baseline: 9200, target: 8000 },
  { re: /monitor|display/i, contract: 11000, baseline: 12500, target: 10400 },
  { re: /keyboard|mouse/i, contract: 2200, baseline: 2600, target: 2050 },
  { re: /backpack|carry ?case|laptop bag/i, contract: 1800, baseline: 2100, target: 1700 },
  { re: /licen[cs]e|office 365|antivirus|software/i, contract: 8200, baseline: 8900, target: 7700 },
  { re: /headset|headphone/i, contract: 3400, baseline: 3900, target: 3200 },
  { re: /laptop|latitude|macbook|notebook/i, contract: 70000, baseline: 72000, target: 67000 },
  { re: /chair|furniture/i, contract: 8000, baseline: 9000, target: 7800 },
  { re: /desk|workstation|table/i, contract: 12500, baseline: 14000, target: 11800 },
  { re: /cabinet|storage unit|pedestal/i, contract: 9500, baseline: 10500, target: 8900 },
  { re: /server|rack/i, contract: 120000, baseline: 130000, target: 115000 },
  { re: /switch|router/i, contract: 45000, baseline: 49000, target: 42500 },
  { re: /ups|power supply/i, contract: 38000, baseline: 41000, target: 35500 },
  { re: /patch panel|cabling|cable/i, contract: 4500, baseline: 5200, target: 4200 },
];
const priceEntry = (name: string) => PRICE_BOOK.find(p => p.re.test(name));
const getContractPrice = (name: string) => priceEntry(name)?.contract ?? 50000;
const getNegotiationBaselinePrice = (name: string) => priceEntry(name)?.baseline ?? 60000;
const getNegotiatedTargetPrice = (name: string) => priceEntry(name)?.target ?? 55000;

// Sub-product suggestions surfaced above the chat bar once the AI recognises a category.
const SUB_CATALOG: Array<{ re: RegExp; category: string; items: string[] }> = [
  {
    re: /laptop|latitude|macbook|notebook|it hardware|computer/i,
    category: 'IT Hardware',
    items: ['USB-C Docking Station', '24" Full-HD Monitor', 'Wireless Keyboard & Mouse Combo', 'Laptop Backpack', 'MS Office 365 Business License', 'Noise-Cancelling Headset'],
  },
  {
    re: /chair|furniture|desk|workstation|seating/i,
    category: 'Office Furniture',
    items: ['Height-Adjustable Desk', 'Ergonomic Office Chair', 'Storage Pedestal Cabinet', 'Conference Table', 'Monitor Arm Mount'],
  },
  {
    re: /server|rack|datacenter|data center|network/i,
    category: 'Datacenter Equipment',
    items: ['19-Inch Data Server Rack', '48-Port Network Switch', 'Rack-Mount UPS 5kVA', 'CAT-6A Patch Panel', 'Structured Cabling Kit'],
  },
];
const subCatalogFor = (text: string) => (text.trim() ? SUB_CATALOG.find(c => c.re.test(text)) : undefined);

// Line-item helpers — every request behaves as a multi-line requisition.
const reqLines = (r: { productName: string; productQty: number; targetPrice: number; lineItems?: LineItem[] }): LineItem[] =>
  r.lineItems && r.lineItems.length ? r.lineItems : [{ productName: r.productName, productQty: r.productQty, targetPrice: r.targetPrice }];
const linesTotal = (lines: LineItem[]) => lines.reduce((s, l) => s + l.productQty * l.targetPrice, 0);
const linesQty = (lines: LineItem[]) => lines.reduce((s, l) => s + l.productQty, 0);
const reqSummary = (r: { productName: string; productQty: number; targetPrice: number; lineItems?: LineItem[] }) => {
  const lines = reqLines(r);
  return lines.length > 1 ? `${lines[0].productName} +${lines.length - 1} more` : lines[0].productName;
};

// ---- Lightweight SVG charts (categorical palette, CVD-safe on the light canvas) ----
const CHART_COLORS = ['#6356A8', '#9B86C6', '#5D79BE', '#0D9476', '#F59E0B', '#64748B'];

// Status colors — drawn from the brand's violet → fuchsia → pink sweep where the
// meaning allows, deep enough to stay legible as text on the light canvas.
// `rgb` carries the same colour as raw channels so CSS can build tinted glows
// and halos from it via rgb(var(--tint) / <alpha>).
const STATUS_META: Record<string, { color: string; rgb: string; short: string; icon: LucideIcon }> = {
  'Draft': { color: '#64748B', rgb: '100 116 139', short: 'Draft', icon: FileText },
  'Pending Approval': { color: '#C27C09', rgb: '194 124 9', short: 'Pending', icon: Clock },
  'Needs Clarification': { color: '#D9622B', rgb: '217 98 43', short: 'Clarify', icon: AlertCircle },
  'Sourcing': { color: '#5D79BE', rgb: '93 121 190', short: 'Sourcing', icon: Search },
  'Approved': { color: '#0C9689', rgb: '12 150 137', short: 'Approved', icon: CheckCircle2 },
  'PO Confirmed': { color: '#6356A8', rgb: '99 86 168', short: 'PO Confirmed', icon: Package },
  'Rejected': { color: '#DB3A4B', rgb: '219 58 75', short: 'Rejected', icon: X },
  'Paid': { color: '#7A63A8', rgb: '122 99 168', short: 'Paid', icon: Landmark },
};
/**
 * Every status a request passes through, in the order it passes through them.
 *
 * The summary lists all of them, including stages nothing is sitting in, so a
 * requester sees the whole journey from raising to payment rather than only
 * the three buckets the statuses used to be collapsed into.
 */
const STATUS_JOURNEY = [
  'Draft', 'Pending Approval', 'Needs Clarification', 'Sourcing',
  'Approved', 'PO Confirmed', 'Paid', 'Rejected', 'Cancelled',
];

/**
 * Tax deducted at source on a vendor bill.
 *
 * Section 194Q covers the purchase of goods at 0.1%, which is what these
 * requisitions are. Kept here so the bill, the payment voucher and anything
 * else that shows a net figure deduct the same amount under the same section.
 */
const TDS = { section: '194Q', rate: 0.1, label: 'Purchase of goods' };
const tdsOn = (gross: number) => Math.round(gross * TDS.rate) / 100;

const statusColor = (s: string) => STATUS_META[s]?.color ?? '#64748B';
const statusRgb = (s: string) => STATUS_META[s]?.rgb ?? '100 116 139';

/**
 * What is happening to this request, in the words a requester would use.
 * Status codes tell you the state; these tell you what it means for you.
 */
const plainStatus = (r: RequestItem): { line: string; waitingOn: string } => {
  const vendor = r.vendor && r.vendor !== 'Pending Sourcing' ? r.vendor : '';
  const order = r.purchaseOrders?.length ? r.purchaseOrders.join(', ') : '';
  switch (r.status) {
    case 'Draft':
      return { line: 'Not sent yet — finish it and submit when you are ready.', waitingOn: 'You' };
    case 'Pending Approval':
      return { line: 'Waiting for your manager to approve it.', waitingOn: 'Your manager' };
    case 'Needs Clarification':
      return { line: 'Your manager asked a question — answer it to keep this moving.', waitingOn: 'You' };
    case 'Sourcing':
      return { line: 'Approved. The buying team is getting prices.', waitingOn: 'SCM Buyer' };
    case 'Approved':
      return { line: 'Approved. Next step is raising the purchase order.', waitingOn: 'SCM Buyer' };
    case 'PO Confirmed':
      return {
        line: order
          ? `Order ${order} placed${vendor ? ` with ${vendor}` : ''} — waiting for delivery.`
          : `Order placed${vendor ? ` with ${vendor}` : ''} — waiting for delivery.`,
        waitingOn: vendor || 'Vendor',
      };
    case 'Paid':
      return { line: 'Delivered and paid. Nothing left to do.', waitingOn: 'Nobody' };
    case 'Rejected':
      return { line: 'Your manager turned this down. Raise a new request if you still need it.', waitingOn: 'Nobody' };
    default:
      return { line: r.status, waitingOn: '—' };
  }
};

// Compact request lifecycle stages (for inline mini-trackers on tiles).
/**
 * What happens to a request after it is submitted, and who owns each step.
 *
 * Mirrors the screens the demo actually walks through — manager approval (#10),
 * budget verification (#9), sourcing and the purchase order (#6, #7, #8),
 * goods receipt (#12), then the bill match and payment (#13, #14) — so the
 * requester is told the same sequence the app then performs.
 */
const NEXT_STEPS: Array<{ stage: string; owner: string; note: string }> = [
  { stage: 'Manager approval', owner: 'Manager', note: 'Approves it, asks you a question, or declines.' },
  { stage: 'Budget & rate contract check', owner: 'Automatic', note: 'Checked against your department budget and the running agreements.' },
  { stage: 'Sourcing & purchase order', owner: 'SCM Buyer', note: 'Applies the contract rate or takes it to market, then raises the PO.' },
  { stage: 'Delivery & goods receipt', owner: 'Stores', note: 'Records what actually arrives against the order.' },
  { stage: 'Bill match & payment', owner: 'Finance', note: 'Three-way match against the PO, then the vendor is paid.' },
];

const STAGE_LABELS = ['Submitted', 'Approved', 'Sourcing', 'PO', 'Received', 'Paid'];
const STATUS_STAGE: Record<string, number> = {
  'Draft': 0, 'Pending Approval': 0, 'Needs Clarification': 0, 'Rejected': 0,
  'Approved': 1, 'Sourcing': 2, 'PO Confirmed': 3, 'Paid': 5,
};
const statusStage = (s: string) => STATUS_STAGE[s] ?? 0;

// The three coloured filter dots on "My Requests" collapse the eight raw
// statuses into three plain buckets the client understands at a glance.
const STATUS_GROUPS: { key: 'action' | 'progress' | 'done'; label: string; color: string; rgb: string; statuses: string[] }[] = [
  { key: 'action',   label: 'Needs attention', color: '#C27C09', rgb: '194 124 9',  statuses: ['Draft', 'Pending Approval', 'Needs Clarification', 'Rejected'] },
  { key: 'progress', label: 'In progress',      color: '#5D79BE', rgb: '93 121 190', statuses: ['Sourcing', 'Approved'] },
  { key: 'done',     label: 'Completed',        color: '#0C9689', rgb: '12 150 137', statuses: ['PO Confirmed', 'Paid'] },
];
const groupOf = (s: string): 'action' | 'progress' | 'done' => STATUS_GROUPS.find(g => g.statuses.includes(s))?.key ?? 'action';

// Shared request filter — status bucket + free-text over id / product / branch /
// department / status / vendor. Used by the home grid, the list tab and the
// buyer / manager queues so search behaves identically everywhere.
const requestHaystack = (r: RequestItem) => `${r.id} ${reqSummary(r)} ${r.productName} ${r.department} ${r.location} ${r.status} ${r.vendor}`.toLowerCase();
/**
 * Newest first — the request somebody just submitted is the first thing the
 * next person to act on it should see.
 *
 * Ordered on `submittedAt`, the ISO timestamp the API sends alongside the
 * display date. Requests still waiting to reach Odoo carry one set locally, so
 * an optimistic insert sorts correctly too. Anything without a timestamp keeps
 * its position behind the ones that have it, rather than jumping to the top.
 */
const newestFirst = (list: RequestItem[]) =>
  [...list].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

/**
 * What a manager is expected to act on.
 *
 * Odoo lets a manager approve from "Needs Clarification" as well as "Pending
 * Approval" — the same Approve button is offered in both states. A queue that
 * looked only at Pending Approval therefore hid requests the manager could and
 * should act on, and they read as simply missing.
 */
const MANAGER_QUEUE_STATUSES = ['Pending Approval', 'Needs Clarification'];

/**
 * What lands in the SCM buyer's queue.
 *
 * A request the manager has just approved is the buyer's to source, but it sits
 * in "Approved" until sourcing actually begins — so a queue that looks only for
 * "Sourcing" never shows it. That gap is why an approved request appeared to
 * stall and the manager ended up doing the buyer's job: the work was assigned
 * to a queue nobody was looking at.
 */
const BUYER_QUEUE_STATUSES = ['Approved', 'Sourcing'];

/**
 * The statuses a role is expected to act on — the inverse of the reminder
 * routing. Read from the request data itself, so the inbox a role is shown on
 * sign-in survives a refresh and does not depend on somebody having submitted
 * in this same browser session.
 */
const queueStatusesForRole = (role: string): string[] =>
  role === 'Manager' ? MANAGER_QUEUE_STATUSES
    : role === 'SCM Buyer' ? BUYER_QUEUE_STATUSES
      : role === 'Vendor' ? ['PO Confirmed']
        : role === 'Employee' ? ['Needs Clarification']
          : [];

/**
 * Whether every signature the configured workflow demands has been given.
 *
 * Used to *show* the outstanding approvals, not to stop anyone: the walkthrough
 * is deliberately allowed to run ahead of them so a demo never stalls waiting
 * for a signature. Odoo still enforces the chain — a request only reaches
 * Approved there once every step has signed.
 *
 * Requests with no chain (raised before the workflow master, or an offline
 * backend) count as clear.
 */
const chainSigned = (r: RequestItem) =>
  !r.approvalChain?.length || (r.approvalDone ?? 0) >= (r.approvalTotal ?? 0);

const filterRequests = (list: RequestItem[], statusKey: string, search: string) => {
  const q = search.trim().toLowerCase();
  return newestFirst(list.filter(r => {
    if (statusKey !== 'all' && r.status !== statusKey) return false;
    return !q || requestHaystack(r).includes(q);
  }));
};

// One chip per status (+ an "All" reset), shared across tabs.
/**
 * Why a step is not offered here, and what to do about it.
 *
 * The role comes from the signed-in account alone, so the answer is always
 * which account to use — naming the role by itself left people with nothing
 * to act on.
 */
function StepLock({ what }: { what: string }) {
  return (
    <p className="text-xs text-textSecondary/70 font-semibold italic">
      Locked: {what}. Sign in as manager@smartspend.demo.
    </p>
  );
}

function StatusDots({ value, onChange, requests }: {
  value: string;
  onChange: (v: string) => void;
  requests: RequestItem[];
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap rounded-2xl bg-surface border border-borderTheme px-1.5 py-1 shadow-sm">
      <button
        onClick={() => onChange('all')}
        title="Show all requests"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${value === 'all' ? 'bg-secondary text-textPrimary' : 'text-textFaint hover:text-textPrimary'}`}
      >
        All <span className="tabular-nums">{requests.length}</span>
      </button>
      {STATUS_JOURNEY.map(status => {
        const active = value === status;
        const count = requests.filter(r => r.status === status).length;
        const color = statusColor(status);
        const rgb = statusRgb(status);
        return (
          <button
            key={status}
            onClick={() => onChange(active ? 'all' : status)}
            title={`${status} · ${count} request${count === 1 ? '' : 's'}`}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold transition-all hover:opacity-100 ${
              count === 0 && !active ? 'opacity-40' : ''}`}
            style={active ? { background: `rgb(${rgb} / 0.12)`, color } : { color: 'rgb(var(--text-faint))' }}
          >
            <span className="h-2.5 w-2.5 rounded-full transition-all shrink-0"
                  style={{ background: color, boxShadow: active ? `0 0 0 3px rgb(${rgb} / 0.25)` : 'none' }} />
            <span>{STATUS_META[status]?.short ?? status}</span>
            <span className="tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// Rounded search field with a leading icon and a clear button, shared across screens.
function RequestSearch({ value, onChange, placeholder = 'Search by ID, product…', className = 'w-60' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-textFaint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${className} max-w-[60vw] bg-surface border border-borderTheme rounded-full pl-9 pr-8 py-2 text-sm text-textPrimary placeholder-textFaint focus:outline-none focus:border-brand shadow-sm`}
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textFaint hover:text-textPrimary" title="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Premium request card on the employee home grid — status icon chip, urgency
 * flag, headline value, delivery date and a gradient lifecycle bar, with a
 * soft status-tinted glow on hover.
 */
function RequestCard({ r, onOpen, onPoke }: { r: RequestItem; onOpen: () => void; onPoke: () => void }) {
  const meta = STATUS_META[r.status];
  const Icon = meta?.icon ?? FileText;
  const color = statusColor(r.status);
  const rgb = statusRgb(r.status);
  const stage = statusStage(r.status);
  const last = r.history[r.history.length - 1];
  const settled = r.status === 'Paid' || r.status === 'PO Confirmed';
  const urgencyTone = r.urgency === 'High' ? '#DB3A4B' : r.urgency === 'Medium' ? '#C27C09' : '#0C9689';
  const plain = plainStatus(r);
  const pct = Math.round((stage / (STAGE_LABELS.length - 1)) * 100);
  return (
    <div
      onClick={onOpen}
      className="request-card group relative cursor-pointer overflow-hidden rounded-2xl bg-surface border border-borderTheme shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg"
      style={{ '--tint': rgb } as React.CSSProperties}
    >
      {/* top accent bar + soft corner glow that lifts on hover */}
      <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: `rgb(${rgb})` }} />
      <span className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `rgb(${rgb} / 0.22)` }} />

      <div className="relative p-5">
        {/* header: icon chip + id + status, urgency on the right */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid h-11 w-11 place-items-center rounded-2xl shrink-0 shadow-sm" style={{ background: `rgb(${rgb} / 0.12)`, color }}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-textFaint tabular-nums tracking-wide">{r.id}</p>
              <span className="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ color, background: `rgb(${rgb} / 0.12)` }}>
                {meta?.short ?? r.status}
              </span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold shrink-0" style={{ color: urgencyTone }} title={`${r.urgency} priority`}>
            <span className="h-2 w-2 rounded-full" style={{ background: urgencyTone }} />
            {r.urgency}
          </span>
        </div>

        {/* what was requested */}
        <p className="mt-4 text-[15px] font-extrabold text-textPrimary leading-snug line-clamp-2">{r.productQty}× {reqSummary(r)}</p>
        <p className="mt-1 text-xs text-textFaint truncate">{r.location.replace(' Office', '')} · {r.department}</p>

        {/* headline value + expected delivery */}
        <div className="mt-4 flex items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Total value</p>
            <p className="text-xl font-extrabold text-textPrimary tabular-nums leading-none mt-1">₹{r.totalCost.toLocaleString()}</p>
          </div>
          {r.deliveryDate && (
            <span className="inline-flex items-center gap-1 text-[11px] text-textSecondary font-semibold whitespace-nowrap">
              <Calendar className="h-3.5 w-3.5" /> {r.deliveryDate}
            </span>
          )}
        </div>

        {/* lifecycle progress */}
        <div className="mt-4">
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `rgb(${rgb})` }} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-bold" style={{ color }}>{STAGE_LABELS[Math.min(stage, STAGE_LABELS.length - 1)]}</span>
            <span className="text-[10px] font-semibold text-textFaint tabular-nums">Step {stage + 1} of {STAGE_LABELS.length}</span>
          </div>
          {/* what the stage actually means for the person reading it */}
          <p className="mt-2 text-[11px] leading-snug text-textSecondary">{plain.line}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-textFaint">
            With: {plain.waitingOn}
          </p>
        </div>

        {/* latest update + poke */}
        <div className="mt-4 pt-3 border-t border-borderTheme/70 flex items-center justify-between gap-2">
          <p className="text-[11px] text-textFaint flex items-center gap-1 min-w-0"><Clock className="h-3 w-3 shrink-0" /><span className="truncate">{last?.title}</span></p>
          {!settled && (
            <button onClick={(e) => { e.stopPropagation(); onPoke(); }} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-brand px-2.5 py-1 rounded-lg hover:bg-brand/10 transition-colors">
              <Bell className="h-3 w-3" /> Poke
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Soft glass banner heading every scene — a light lavender-tinted panel with
 * dark text. `stats` renders quiet KPI chips on the right; `right` takes
 * bespoke controls (toggles, badges), which should use .hero-ctl.
 */
/**
 * Tiles or rows, for any list that has both.
 *
 * Cards read well when you are browsing; rows read well when you are scanning
 * thirty of them for one reference. Neither is right for everything, so the
 * choice is the reader's.
 */
function ViewToggle({ value, onChange }: { value: 'grid' | 'list'; onChange: (v: 'grid' | 'list') => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface border border-borderTheme p-0.5 shadow-sm">
      {([['grid', LayoutGrid, 'Tile view'], ['list', ListIcon, 'List view']] as const).map(([k, Icon, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          title={label}
          aria-label={label}
          aria-pressed={value === k}
          className={`grid h-7 w-7 place-items-center rounded-md transition-all ${
            value === k ? 'bg-brand text-onbrand' : 'text-textFaint hover:text-brand'}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

/** The same requests as rows — one line each, scannable at a glance. */
function RequestRows({ rows, onOpen }: { rows: RequestItem[]; onOpen: (r: RequestItem) => void }) {
  return (
    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[720px]">
          <thead>
            <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
              <th className="px-4 py-2.5 font-bold">Reference</th>
              <th className="px-4 py-2.5 font-bold">Product</th>
              <th className="px-4 py-2.5 font-bold">Branch · Department</th>
              <th className="px-4 py-2.5 font-bold">Status</th>
              <th className="px-4 py-2.5 font-bold text-right">Value</th>
              <th className="px-4 py-2.5 font-bold">Needed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                onClick={() => onOpen(r)}
                className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 text-[11px] font-mono font-bold text-textFaint whitespace-nowrap">{r.id}</td>
                <td className="px-4 py-3 text-xs font-bold text-textPrimary">
                  {r.productQty}× {reqSummary(r)}
                </td>
                <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{r.location} · {r.department}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                    style={{
                      background: `rgb(${statusRgb(r.status)} / 0.12)`,
                      color: statusColor(r.status),
                      borderColor: `rgb(${statusRgb(r.status)} / 0.25)`,
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor(r.status) }} />
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-bold text-textPrimary tabular-nums text-right whitespace-nowrap">
                  ₹{r.totalCost.toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{r.deliveryDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SceneHeader({ icon: Icon, title, subtitle, stats, right, className = '' }: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel-hero px-6 py-5 ${className}`}>
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl grid place-items-center shrink-0 bg-brand/10 border border-borderTheme">
            <Icon className="h-6 w-6 text-brand" />
          </div>
          <div>
            <h2 className="font-outfit text-2xl font-extrabold text-textPrimary leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-textSecondary mt-0.5 max-w-2xl">{subtitle}</p>}
          </div>
        </div>
        {(!!stats?.length || right) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {stats?.map(s => (
              <div key={s.label} className="rounded-2xl px-4 py-2 text-center bg-brand/5 border border-borderTheme">
                <p className="text-xl font-extrabold text-textPrimary font-outfit leading-none tabular-nums">
                  <CountUp value={s.value} />
                </p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-textSecondary mt-1">{s.label}</p>
              </div>
            ))}
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Calm light KPI/status card — a white glass surface. `tint` (raw RGB channels)
 * colours only the icon chip, sparkline, corner glow and meter, so the card
 * stays quiet like the reference's white cards.
 */
function StatTile({ icon: Icon, tint, value, label, caption, meter, delay = 0, spark, curr, prev, lowerIsBetter }: {
  icon: LucideIcon;
  tint: string;
  value: string | number;
  label: string;
  caption?: string;
  meter?: number;      // 0–100, omit to hide the bar
  delay?: number;
  spark?: number[];    // optional trend line across the foot of the tile
  curr?: number;       // with `prev`, renders a period-over-period chip
  prev?: number;
  lowerIsBetter?: boolean;
}) {
  return (
    <div
      className="stat-tile p-3.5 animate-fadeIn"
      style={{ '--tint': tint, animationDelay: `${delay}ms` } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[26px] font-extrabold text-textPrimary font-outfit leading-none tabular-nums">
          <CountUp value={value} />
        </p>
        <div className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ background: 'rgb(var(--tint) / 0.14)' }}>
          <Icon className="h-3.5 w-3.5" style={{ color: 'rgb(var(--tint))' }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-wider text-textSecondary">{label}</p>
        {curr !== undefined && prev !== undefined && (
          <DeltaChip curr={curr} prev={prev} lowerIsBetter={lowerIsBetter} />
        )}
      </div>
      {caption && <p className="text-[10px] text-textFaint mt-1 truncate">{caption}</p>}
      {spark && <Sparkline data={spark} stroke={`rgb(${tint})`} className="w-full h-7 mt-1.5 opacity-90" />}
      {meter !== undefined && (
        <div className="mt-2 h-[3px] rounded-full bg-black/[0.06] overflow-hidden">
          <div className="stat-meter" style={{ width: `${meter}%` }} />
        </div>
      )}
    </div>
  );
}

// Read-only requisition line table — reused by every downstream scene so multi-product
// requests keep their full detail from sourcing through payment.
/**
 * The approval chain a request is running, as the configured workflow set it.
 *
 * Signing is sequential, so the chain reads as a track: what has been signed,
 * the one step it is waiting on, and what is still to come. Rendered wherever
 * somebody needs to know why a request has not moved — an approver looking at
 * their queue, and a requester tracking their own.
 *
 * Absent on requests raised before the workflow master existed, and on a
 * backend that does not send the chain, so the caller renders nothing then
 * rather than an empty box.
 */
function ApprovalChain({ request, compact = false }: { request: RequestItem; compact?: boolean }) {
  const chain = request.approvalChain ?? [];
  if (!chain.length) return null;

  const done = request.approvalDone ?? chain.filter(s => s.state === 'approved').length;
  const total = request.approvalTotal ?? chain.length;
  const waiting = chain.find(s => s.state === 'pending');
  const rejected = chain.find(s => s.state === 'rejected');

  return (
    <div className={`rounded-xl border border-borderTheme bg-secondary/40 ${compact ? 'p-3.5' : 'p-4'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">
            Approval chain
          </span>
          {request.workflow && (
            <span className="font-mono text-[10px] text-textFaint">{request.workflow}</span>
          )}
        </div>
        <span className="text-[11px] font-bold text-textPrimary tabular-nums">
          {done} of {total} signed
        </span>
      </div>

      {/* Progress across the whole chain, so "stuck at step 2 of 3" reads at a glance */}
      <div className="mt-2 h-1.5 rounded-full bg-raised overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${rejected ? 'bg-neg' : 'bg-pos'}`}
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>

      <ol className={`mt-3 ${compact ? 'space-y-1.5' : 'space-y-2'}`}>
        {chain.map(step => {
          const isWaiting = step.state === 'pending' && step === waiting;
          const tone = step.state === 'approved' ? 'pos'
            : step.state === 'rejected' ? 'neg'
            : isWaiting ? 'gold' : 'faint';
          return (
            <li key={step.order} className="flex items-start gap-2.5">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold border ${
                  tone === 'pos' ? 'bg-pos/12 text-pos border-pos/35'
                  : tone === 'neg' ? 'bg-neg/12 text-neg border-neg/35'
                  : tone === 'gold' ? 'bg-gold/15 text-gold border-gold/40 animate-pulse'
                  : 'bg-surface text-textFaint border-borderTheme'}`}
              >
                {step.state === 'approved' ? <Check className="h-3 w-3" />
                  : step.state === 'rejected' ? <X className="h-3 w-3" />
                  : step.order}
              </span>
              <div className="min-w-0 flex-grow">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[11px] font-bold ${
                    tone === 'faint' ? 'text-textFaint' : 'text-textPrimary'}`}>
                    {step.designation}
                  </span>
                  {isWaiting && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">
                      Waiting
                    </span>
                  )}
                  {/* Name the account, not just the role. "Finance CapEx Head"
                      is not something anyone can log in as. */}
                  {step.state === 'pending' && !!step.holders?.length && (
                    <span className="text-[10px] text-textSecondary truncate">
                      {step.holders.map(h => h.login).join(' / ')}
                    </span>
                  )}
                  {step.state === 'pending' && !step.holders?.length && (
                    <span className="text-[10px] font-bold text-gold">no holder assigned</span>
                  )}
                  {step.state === 'approved' && step.decidedBy && (
                    <span className="text-[10px] text-textSecondary truncate">
                      {step.decidedBy}{step.decidedOn ? ` · ${step.decidedOn}` : ''}
                    </span>
                  )}
                  {step.state === 'rejected' && (
                    <span className="text-[10px] font-bold text-neg">Declined</span>
                  )}
                </div>
                {!compact && step.note && (
                  <p className="text-[11px] text-textSecondary mt-0.5 italic">“{step.note}”</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {waiting && !rejected && (
        <div className="mt-3 pt-2.5 border-t border-borderTheme text-[11px] text-textSecondary">
          <p>
            Waiting on the <strong className="text-textPrimary">{waiting.designation}</strong>.
            {total - done > 1
              ? ` ${total - done} signatures still to come.`
              : ' This is the last signature.'}
          </p>
          {waiting.holders?.length ? (
            <p className="mt-1">
              Sign in as{' '}
              {waiting.holders.map((h, i) => (
                <React.Fragment key={h.login}>
                  {i > 0 && ' or '}
                  <strong className="text-brand font-mono">{h.login}</strong>
                  <span className="text-textFaint"> ({h.name})</span>
                </React.Fragment>
              ))}
              {' '}to approve it.
            </p>
          ) : (
            <p className="mt-1 text-gold font-semibold">
              Nobody holds this designation yet — assign a user to it in Configuration
              (Configuration ▸ Designations), or any SmartSpend manager can sign it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LineItemsTable({ lines, title = 'Line Items', totalLabel = 'Total' }: { lines: LineItem[]; title?: string; totalLabel?: string }) {
  return (
    <div className="rounded-xl border border-borderTheme overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/60 border-b border-borderTheme">
        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">{title}</span>
        <span className="text-[10px] font-bold text-textSecondary">{lines.length} product{lines.length > 1 ? 's' : ''} · {linesQty(lines)} units</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[420px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-textFaint">
              <th className="text-left font-bold px-3 py-2">Product</th>
              <th className="text-right font-bold px-3 py-2">Qty</th>
              <th className="text-right font-bold px-3 py-2">Unit ₹</th>
              <th className="text-right font-bold px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-borderTheme/60">
                <td className="px-3 py-2 text-textPrimary font-semibold">{l.productName}</td>
                <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{l.productQty}</td>
                <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{l.targetPrice ? `₹${l.targetPrice.toLocaleString()}` : 'TBD'}</td>
                <td className="px-3 py-2 text-right text-textPrimary font-bold tabular-nums">{l.targetPrice ? `₹${(l.productQty * l.targetPrice).toLocaleString()}` : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-borderTheme bg-secondary/40">
              <td className="px-3 py-2 font-bold text-textSecondary" colSpan={3}>{totalLabel}</td>
              <td className="px-3 py-2 text-right font-extrabold text-brand tabular-nums">₹{linesTotal(lines).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface Datum { label: string; value: number; }

// Donut for composition/identity (branch share of spend) + legend with values.
function DonutChart({ data, prefix = '', suffix = '' }: { data: Datum[]; prefix?: string; suffix?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 56, C = 2 * Math.PI * R, GAP = 3;
  let offset = 0;
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative flex-shrink-0">
        <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgb(var(--bg-secondary))" strokeWidth="15" />
          {data.map((d, i) => {
            const frac = d.value / total;
            const len = Math.max(frac * C - GAP, 0);
            const el = (
              <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth="15" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
            );
            offset += frac * C;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] text-textFaint font-semibold uppercase tracking-wider">Total</span>
          <span className="text-lg font-extrabold text-textPrimary font-outfit">{prefix}{total.toFixed(2)}{suffix}</span>
        </div>
      </div>
      <div className="space-y-1.5 min-w-[9rem]">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="text-textSecondary font-medium w-24 truncate">{d.label}</span>
            <span className="text-textPrimary font-bold tabular-nums ml-auto">{prefix}{d.value}{suffix}</span>
            <span className="text-textFaint tabular-nums w-8 text-right">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal magnitude bars — single hue, sorted, direct-labeled.
function BarList({ data, color = '#6356A8', prefix = '', suffix = '' }: { data: Datum[]; color?: string; prefix?: string; suffix?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-3">
      {[...data].sort((a, b) => b.value - a.value).map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-textSecondary font-medium truncate pr-2">{d.label}</span>
            <span className="text-textPrimary font-bold tabular-nums">{prefix}{d.value}{suffix}</span>
          </div>
          <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// A breakdown row carries last period's figure too, so every table can show
// share-of-total AND movement without a second data source.
interface BreakdownRow { label: string; value: number; prev?: number; meta?: string; }

// Dashboard breakdown "focus" filter — when a specific row is picked, collapse
// the rest into an "Others" bucket so the chart clearly compares the selection.
const focusRows = (rows: BreakdownRow[], label: string): BreakdownRow[] => {
  if (label === 'All') return rows;
  const sel = rows.find(r => r.label === label);
  if (!sel) return rows;
  const rest = rows.filter(r => r.label !== label);
  return [sel, {
    label: 'Others',
    value: rest.reduce((s, r) => s + r.value, 0),
    prev: rest.reduce((s, r) => s + (r.prev ?? 0), 0),
    meta: `${rest.length} more`,
  }];
};

// Company-wide spend analytics for the CEO / consolidated dashboards (₹ Crore
// unless the field says otherwise). FY 2026, year-to-date.
const spendAnalytics = {
  headline: {
    audited: 4.58, budget: 5.40, auditedPrev: 3.96,   // ₹ Cr
    savings: 28.45, savingsPrev: 19.80,               // ₹ Lakh
    anomalies: 4, anomaliesPrev: 9,
    cycleDays: 6.4, cycleDaysPrev: 11.2,
    poCount: 412, poCountPrev: 358,
    vendors: 87, contractCoverage: 78,                // %
  },
  // 7-point series backing the KPI sparklines (Jan → Jul)
  sparks: {
    spend:     [0.38, 0.42, 0.52, 0.61, 0.74, 0.69, 1.14],
    savings:   [1.8, 2.4, 3.1, 4.0, 4.6, 5.9, 6.65],
    cycle:     [11.2, 10.4, 9.1, 8.6, 7.4, 6.9, 6.4],
    anomalies: [3, 2, 4, 2, 1, 1, 0],
  },
  byBranch: [
    { label: 'Bangalore', value: 1.62, prev: 1.38, meta: '148 orders' },
    { label: 'Mumbai',    value: 1.18, prev: 1.02, meta: '106 orders' },
    { label: 'Kochi',     value: 0.86, prev: 0.71, meta: '74 orders' },
    { label: 'Delhi',     value: 0.58, prev: 0.62, meta: '52 orders' },
    { label: 'Chennai',   value: 0.34, prev: 0.23, meta: '32 orders' },
  ] as BreakdownRow[],
  byDepartment: [
    { label: 'IT & Infrastructure', value: 1.94, prev: 1.52, meta: 'Budget ₹2.10 Cr' },
    { label: 'Operations',          value: 1.12, prev: 1.06, meta: 'Budget ₹1.20 Cr' },
    { label: 'Facilities',          value: 0.72, prev: 0.64, meta: 'Budget ₹0.90 Cr' },
    { label: 'Marketing',           value: 0.48, prev: 0.51, meta: 'Budget ₹0.70 Cr' },
    { label: 'Finance',             value: 0.32, prev: 0.23, meta: 'Budget ₹0.50 Cr' },
  ] as BreakdownRow[],
  byCategory: [
    { label: 'IT Hardware',           value: 1.48, prev: 1.14, meta: '18 vendors' },
    { label: 'Datacenter Equipment',  value: 0.92, prev: 0.68, meta: '9 vendors' },
    { label: 'Software Licenses',     value: 0.74, prev: 0.71, meta: '14 vendors' },
    { label: 'Office Furniture',      value: 0.56, prev: 0.62, meta: '11 vendors' },
    { label: 'Professional Services', value: 0.44, prev: 0.39, meta: '21 vendors' },
    { label: 'MRO Supplies',          value: 0.44, prev: 0.42, meta: '14 vendors' },
  ] as BreakdownRow[],
  // Actual vs allocated, month by month — drives the trend chart.
  byMonth: [
    { label: 'Jan', value: 0.38, budget: 0.55 },
    { label: 'Feb', value: 0.52, budget: 0.55 },
    { label: 'Mar', value: 0.61, budget: 0.60 },
    { label: 'Apr', value: 0.74, budget: 0.72 },
    { label: 'May', value: 0.69, budget: 0.78 },
    { label: 'Jun', value: 0.88, budget: 0.85 },
    { label: 'Jul', value: 1.14, budget: 0.95 },
  ],
  // Where the ₹28.45 L of savings actually came from (₹ Lakh).
  savingsLevers: [
    { label: 'AI autonomous negotiation', value: 11.20, meta: '38 deals closed' },
    { label: 'Rate contract enforcement', value: 7.60,  meta: '112 lines priced' },
    { label: 'Demand consolidation',      value: 4.85,  meta: '26 requests merged' },
    { label: 'Vendor switch on scorecard',value: 3.10,  meta: '9 switches' },
    { label: 'Tail-spend catalogue',      value: 1.70,  meta: '64 small buys' },
  ],
  topVendors: [
    { name: 'Dell Technologies',  spend: 1.24, orders: 62, onTime: 96, savings: 8.4, rating: 4.8, trend: [0.8, 0.9, 1.0, 1.1, 1.15, 1.2, 1.24] },
    { name: 'Cisco Systems',      spend: 0.86, orders: 28, onTime: 92, savings: 5.1, rating: 4.6, trend: [0.5, 0.6, 0.62, 0.7, 0.76, 0.8, 0.86] },
    { name: 'Featherlite Office', spend: 0.54, orders: 41, onTime: 88, savings: 3.6, rating: 4.3, trend: [0.42, 0.44, 0.47, 0.5, 0.48, 0.52, 0.54] },
    { name: 'Redington India',    spend: 0.47, orders: 55, onTime: 94, savings: 4.2, rating: 4.5, trend: [0.3, 0.34, 0.38, 0.4, 0.43, 0.45, 0.47] },
    { name: 'Schneider Electric', spend: 0.39, orders: 19, onTime: 90, savings: 2.8, rating: 4.4, trend: [0.22, 0.25, 0.28, 0.31, 0.34, 0.36, 0.39] },
  ],
  // Average days per stage — the funnel the AI is compressing.
  cycleStages: [
    { label: 'Request → Approval', days: 0.6, prevDays: 2.4 },
    { label: 'Approval → Sourcing', days: 1.1, prevDays: 2.8 },
    { label: 'Sourcing → PO',       days: 1.8, prevDays: 3.1 },
    { label: 'PO → Receipt',        days: 2.4, prevDays: 2.2 },
    { label: 'Receipt → Payment',   days: 0.5, prevDays: 0.7 },
  ],
  compliance: [
    { label: 'PO-backed spend',     pct: 94, target: 90 },
    { label: 'Rate contract usage', pct: 78, target: 85 },
    { label: '3-way match pass',    pct: 97, target: 95 },
    { label: 'Maverick spend',      pct: 6,  target: 10, lowerIsBetter: true },
  ],
  anomalies: [
    { title: 'Duplicate invoice detected', vendor: 'Redington India', amount: '₹4.82 L', severity: 'High',   note: 'INV-88412 matches INV-88377 line-for-line' },
    { title: 'Price above contract rate',  vendor: 'Featherlite Office', amount: '₹1.16 L', severity: 'High', note: 'Chair unit rate ₹9,400 vs contracted ₹8,000' },
    { title: 'Split PO to dodge approval', vendor: 'Local Supplies Co', amount: '₹2.40 L', severity: 'Medium', note: '3 POs raised same day under the ₹1 L limit' },
    { title: 'Delivery short-received',    vendor: 'Cisco Systems', amount: '₹0.94 L', severity: 'Low',    note: 'GRN qty 18 against PO qty 20' },
  ],
};

/* ===================================================================
   Transaction-level spend ledger — the source of truth behind the CEO
   dashboard. Every KPI and chart is DERIVED from these rows, so the
   branch / department / category / date filters genuinely cross-filter the
   whole board (pick Bangalore + IT + March and every number re-computes).
   The ledger is generated once, deterministically (seeded), so the demo
   is stable across reloads.
   =================================================================== */

const DASH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
const DASH_BRANCHES = ['Bangalore', 'Mumbai', 'Kochi', 'Delhi', 'Chennai'];
const DASH_DEPTS = ['IT & Infrastructure', 'Operations', 'Facilities', 'Marketing', 'Finance'];
const DASH_CATS = ['IT Hardware', 'Datacenter Equipment', 'Software Licenses', 'Office Furniture', 'Professional Services', 'MRO Supplies'];
const DASH_LEVERS = ['AI autonomous negotiation', 'Rate contract enforcement', 'Demand consolidation', 'Vendor switch on scorecard', 'Tail-spend catalogue'];

// Sampling weights that reproduce the marketing narrative's mix.
const BRANCH_W = [35, 26, 19, 12, 8];
const DEPT_W = [42, 24, 16, 10, 8];
const MONTH_W = [0.38, 0.52, 0.61, 0.74, 0.69, 0.88, 1.14];
const LEVER_W = [39, 27, 17, 11, 6];
// Category mix depends on the department buying (IT buys hardware, Facilities buys furniture…).
const DEPT_CAT_W: Record<string, number[]> = {
  'IT & Infrastructure': [40, 30, 22, 1, 5, 2],
  'Operations':          [15, 10, 10, 10, 25, 30],
  'Facilities':          [4, 2, 2, 45, 12, 35],
  'Marketing':           [15, 1, 25, 10, 44, 5],
  'Finance':             [15, 1, 40, 5, 34, 5],
};
const CAT_VENDORS: Record<string, { name: string; w: number }[]> = {
  'IT Hardware':           [{ name: 'Dell Technologies', w: 5 }, { name: 'HP Enterprise', w: 3 }, { name: 'Lenovo', w: 2 }],
  'Datacenter Equipment':  [{ name: 'Cisco Systems', w: 5 }, { name: 'Schneider Electric', w: 3 }, { name: 'Juniper Networks', w: 2 }],
  'Software Licenses':     [{ name: 'Microsoft', w: 4 }, { name: 'Adobe', w: 3 }, { name: 'Atlassian', w: 2 }],
  'Office Furniture':      [{ name: 'Featherlite Office', w: 5 }, { name: 'Godrej Interio', w: 3 }, { name: 'Steelcase', w: 2 }],
  'Professional Services': [{ name: 'Deloitte Advisory', w: 4 }, { name: 'KPMG', w: 3 }, { name: 'EY Consulting', w: 3 }],
  'MRO Supplies':          [{ name: 'Grainger', w: 4 }, { name: 'CleanServe', w: 3 }, { name: 'Redington India', w: 3 }],
};
const CAT_BASE: Record<string, number> = { // ₹ Lakh per line before the random factor
  'IT Hardware': 0.9, 'Datacenter Equipment': 2.0, 'Software Licenses': 0.75,
  'Office Furniture': 0.58, 'Professional Services': 1.05, 'MRO Supplies': 0.3,
};
const VENDOR_RATING: Record<string, number> = {
  'Dell Technologies': 4.8, 'HP Enterprise': 4.5, 'Lenovo': 4.4, 'Cisco Systems': 4.6,
  'Schneider Electric': 4.4, 'Juniper Networks': 4.3, 'Microsoft': 4.7, 'Adobe': 4.5,
  'Atlassian': 4.4, 'Featherlite Office': 4.3, 'Godrej Interio': 4.2, 'Steelcase': 4.5,
  'Deloitte Advisory': 4.6, 'KPMG': 4.5, 'EY Consulting': 4.4, 'Grainger': 4.3,
  'CleanServe': 4.1, 'Redington India': 4.5,
};
// Year-on-year growth per dimension, so the breakdown "vs last year" chips read true.
const BRANCH_YOY: Record<string, number> = { Bangalore: 0.17, Mumbai: 0.16, Kochi: 0.21, Delhi: -0.06, Chennai: 0.48 };
const DEPT_YOY: Record<string, number> = { 'IT & Infrastructure': 0.28, Operations: 0.06, Facilities: 0.13, Marketing: -0.06, Finance: 0.39 };
const CAT_YOY: Record<string, number> = { 'IT Hardware': 0.30, 'Datacenter Equipment': 0.35, 'Software Licenses': 0.04, 'Office Furniture': -0.10, 'Professional Services': 0.13, 'MRO Supplies': 0.05 };

// ============================================================================
// MASTER DATA CONSOLE (Scene 16)
// The reference records everything else is built on. Products, categories and
// branches are derived from the very same sources the request flow already
// uses — SUB_CATALOG, PRICE_BOOK, CAT_VENDORS and the Odoo /master-data feed —
// so this screen can never drift from what a requester sees in the dropdowns.
// ============================================================================

interface MasterProduct {
  code: string; name: string; category: string; uom: string;
  contract: number; vendor: string; onContract: boolean;
}

/** Catalogue products, priced from the same book the requisition form quotes. */
const MASTER_PRODUCTS: MasterProduct[] = (() => {
  const vendorFor: Record<string, string> = {
    'IT Hardware': 'Dell Technologies',
    'Office Furniture': 'Featherlite Office',
    'Datacenter Equipment': 'Cisco Systems',
  };
  const uomFor = (name: string) =>
    /licen[cs]e/i.test(name) ? 'Seat / Year' : /cabling|patch/i.test(name) ? 'Kit' : 'Nos';
  let n = 0;
  return SUB_CATALOG.flatMap(group =>
    group.items.map(item => {
      n += 1;
      return {
        code: `PRD-${String(n).padStart(4, '0')}`,
        name: item,
        category: group.category,
        uom: uomFor(item),
        contract: getContractPrice(item),
        vendor: vendorFor[group.category] ?? 'Multiple',
        onContract: !!priceEntry(item),
      };
    }),
  );
})();

interface MasterCategory {
  name: string; expenseType: string; glCode: string; limit: number; owner: string;
}

/** Expense categories — the fallback set, used when Odoo's /master-data feed
 *  is unreachable. When it answers, its categories take over the name and
 *  expense type and these rows supply the accounting detail. */
const MASTER_CATEGORIES: MasterCategory[] = [
  { name: 'IT Hardware', expenseType: 'CapEx', glCode: '1520-IT-HW', limit: 500000, owner: 'IT & Infrastructure' },
  { name: 'Datacenter Equipment', expenseType: 'CapEx', glCode: '1530-DC-EQ', limit: 2000000, owner: 'IT & Infrastructure' },
  { name: 'Software Licenses', expenseType: 'OpEx', glCode: '6410-SW-LIC', limit: 300000, owner: 'IT & Infrastructure' },
  { name: 'Office Furniture', expenseType: 'CapEx', glCode: '1540-FF-OF', limit: 250000, owner: 'Facilities' },
  { name: 'Professional Services', expenseType: 'OpEx', glCode: '6620-PROF-SV', limit: 750000, owner: 'Finance' },
  { name: 'MRO Supplies', expenseType: 'OpEx', glCode: '6310-MRO-SP', limit: 100000, owner: 'Operations' },
];

interface WorkflowStage {
  seq: number; stage: string; role: string; rule: string; sla: string; auto: boolean;
}

/** The approval ladder every request climbs. Stages 3, 4 and 8 run without a
 *  human — that is the whole pitch, so the console marks them. */
const MASTER_WORKFLOW: WorkflowStage[] = [
  { seq: 1, stage: 'Request Raised', role: 'Employee', rule: 'Any value', sla: 'Same day', auto: false },
  { seq: 2, stage: 'Manager Approval', role: 'Reporting Manager', rule: 'Up to ₹2,00,000', sla: '24 hours', auto: false },
  { seq: 3, stage: 'Budget Check', role: 'System', rule: 'Against the department budget', sla: 'Instant', auto: true },
  { seq: 4, stage: 'Rate Contract Match', role: 'System', rule: 'Running agreements only', sla: 'Instant', auto: true },
  { seq: 5, stage: 'Sourcing / Negotiation', role: 'SCM Buyer', rule: 'When no contract covers it', sla: '3 days', auto: false },
  { seq: 6, stage: 'Finance Approval', role: 'Finance Head', rule: 'Above ₹5,00,000', sla: '48 hours', auto: false },
  { seq: 7, stage: 'PO Release', role: 'SCM Buyer', rule: 'After every approval clears', sla: 'Same day', auto: false },
  { seq: 8, stage: 'GRN & 3-Way Match', role: 'Stores + System', rule: 'PO = GRN = Invoice', sla: 'On delivery', auto: true },
  { seq: 9, stage: 'Payment Release', role: 'Finance', rule: 'Per vendor payment terms', sla: 'Net 30', auto: false },
];

interface MasterVendor {
  name: string; category: string; rating: number; code: string;
  terms: string; since: string; status: 'Active' | 'On Hold';
  origin: 'Onboarded' | 'AI Discovered';
}

/** The approved vendor master, assembled from the categories and ratings the
 *  analytics ledger already scores vendors on. */
const MASTER_VENDORS: MasterVendor[] = (() => {
  const terms = ['Net 30', 'Net 45', 'Net 15', 'Advance 20% / Net 30'];
  let n = 0;
  return Object.entries(CAT_VENDORS).flatMap(([category, vendors]) =>
    vendors.map(v => {
      n += 1;
      return {
        name: v.name,
        category,
        rating: VENDOR_RATING[v.name] ?? 4.0,
        code: `VEN-${String(n).padStart(4, '0')}`,
        terms: terms[n % terms.length],
        since: `20${18 + (n % 6)}`,
        status: (n % 9 === 0 ? 'On Hold' : 'Active') as 'Active' | 'On Hold',
        origin: 'Onboarded' as const,
      };
    }),
  );
})();

// ---- AI-discovered vendors, held as drafts until a human signs them off ----

interface DraftField {
  label: string; value: string; source: string; confidence: number;
}
interface DraftSignal { label: string; tone: 'good' | 'warn' | 'bad'; }
interface DraftVendor {
  id: string; name: string; category: string; city: string;
  aiScore: number; trust: number; foundFor: string; foundAt: string;
  fields: DraftField[];
  missing: string[];
  signals: DraftSignal[];
}

/** Sample discovery results. Each draft carries the provenance of every field
 *  the agent filled, so an approver can see exactly what was inferred and from
 *  where before it is promoted into the vendor master. */
const AI_DRAFT_VENDORS: DraftVendor[] = [
  {
    id: 'DRAFT-0091',
    name: 'Global Hardware Integrators',
    category: 'Datacenter Equipment',
    city: 'Bengaluru, KA',
    aiScore: 95, trust: 92,
    foundFor: 'REQ-2041 · 19-Inch Data Server Rack',
    foundAt: '2 minutes ago',
    fields: [
      { label: 'Legal name', value: 'Global Hardware Integrators Pvt Ltd', source: 'MCA registry', confidence: 98 },
      { label: 'GSTIN', value: '29AAFCGptr4K1ZV (sample)', source: 'GST portal', confidence: 96 },
      { label: 'Registered office', value: 'Whitefield, Bengaluru 560066', source: 'MCA registry', confidence: 94 },
      { label: 'Category fit', value: 'Servers, racks & IT networking', source: 'Catalogue match', confidence: 91 },
      { label: 'Annual turnover', value: '₹84 Cr (FY24)', source: 'Filed accounts', confidence: 88 },
      { label: 'Payment terms offered', value: 'Net 30', source: 'Public rate card', confidence: 72 },
    ],
    missing: ['Bank account details', 'MSME certificate'],
    signals: [
      { label: 'GST active · filings current', tone: 'good' },
      { label: 'Supplies 3 of our peer companies', tone: 'good' },
      { label: 'No prior transaction history with us', tone: 'warn' },
    ],
  },
  {
    id: 'DRAFT-0092',
    name: 'Apex Sourcing Solutions',
    category: 'Office Furniture',
    city: 'Chennai, TN',
    aiScore: 88, trust: 85,
    foundFor: 'REQ-2038 · Height-Adjustable Desk',
    foundAt: '11 minutes ago',
    fields: [
      { label: 'Legal name', value: 'Apex Sourcing Solutions LLP', source: 'MCA registry', confidence: 97 },
      { label: 'GSTIN', value: '33AAGFA ptr9M1Z8 (sample)', source: 'GST portal', confidence: 95 },
      { label: 'Registered office', value: 'Guindy, Chennai 600032', source: 'MCA registry', confidence: 93 },
      { label: 'Category fit', value: 'Office furniture & fit-out', source: 'Catalogue match', confidence: 86 },
      { label: 'Annual turnover', value: '₹22 Cr (FY24)', source: 'Filed accounts', confidence: 79 },
    ],
    missing: ['Bank account details', 'Quality certification', 'Signed NDA'],
    signals: [
      { label: 'GST active · filings current', tone: 'good' },
      { label: 'Quotes 8% under our current furniture rate', tone: 'good' },
      { label: 'One late-delivery complaint on a public forum', tone: 'warn' },
    ],
  },
  {
    id: 'DRAFT-0093',
    name: 'Zenith Business Networks',
    category: 'Datacenter Equipment',
    city: 'Pune, MH',
    aiScore: 91, trust: 88,
    foundFor: 'REQ-2041 · 48-Port Network Switch',
    foundAt: '11 minutes ago',
    fields: [
      { label: 'Legal name', value: 'Zenith Business Networks Pvt Ltd', source: 'MCA registry', confidence: 96 },
      { label: 'GSTIN', value: '27AACCZ ptr2H1ZK (sample)', source: 'GST portal', confidence: 94 },
      { label: 'Registered office', value: 'Hinjewadi, Pune 411057', source: 'MCA registry', confidence: 92 },
      { label: 'Category fit', value: 'Network switching & structured cabling', source: 'Catalogue match', confidence: 90 },
      { label: 'Annual turnover', value: '₹41 Cr (FY24)', source: 'Filed accounts', confidence: 84 },
      { label: 'Payment terms offered', value: 'Net 45', source: 'Public rate card', confidence: 70 },
    ],
    missing: ['Bank account details'],
    signals: [
      { label: 'GST active · filings current', tone: 'good' },
      { label: 'Authorised Cisco reseller', tone: 'good' },
      { label: 'Director shares an address with an existing vendor', tone: 'bad' },
    ],
  },
];

interface Txn {
  month: number; branch: string; department: string; category: string; vendor: string;
  amount: number; budget: number; savings: number; lever: string; cycleDays: number;
  onTime: boolean; onContract: boolean; matched: boolean; withinPolicy: boolean; competitive: boolean;
  anomaly?: { title: string; severity: 'High' | 'Medium' | 'Low'; note: string };
}

// Small seeded PRNG (mulberry32) + weighted pick, so the ledger is deterministic.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wpick = <T,>(rng: () => number, items: T[], weights: number[]): T => {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { if ((r -= weights[i]) <= 0) return items[i]; }
  return items[items.length - 1];
};

const DASH_TXNS: Txn[] = (() => {
  const rng = mulberry32(20260724);
  const txns: Txn[] = [];
  for (let i = 0; i < 412; i++) {
    const branch = wpick(rng, DASH_BRANCHES, BRANCH_W);
    const department = wpick(rng, DASH_DEPTS, DEPT_W);
    const category = wpick(rng, DASH_CATS, DEPT_CAT_W[department]);
    const vs = CAT_VENDORS[category];
    const vendor = wpick(rng, vs.map(v => v.name), vs.map(v => v.w));
    const month = wpick(rng, [0, 1, 2, 3, 4, 5, 6], MONTH_W);
    const amount = Math.round(CAT_BASE[category] * (0.5 + rng() * 1.2) * 100000);
    const util = 0.62 + rng() * 0.4 + month * 0.014;  // later months run tighter to budget (~85% used, July tips over)
    const savings = rng() < 0.85 ? Math.round(amount * (0.04 + rng() * 0.075)) : 0;
    txns.push({
      month, branch, department, category, vendor, amount,
      budget: Math.round(amount / util), savings,
      lever: wpick(rng, DASH_LEVERS, LEVER_W),
      cycleDays: +(3 + rng() * 6.8).toFixed(1),
      onTime: rng() < 0.92, onContract: rng() < 0.78, matched: rng() < 0.965,
      withinPolicy: rng() < 0.94, competitive: rng() < 0.88,
    });
  }
  // Flag a spread of transactions as caught anomalies (varied branch/category/vendor).
  const anomalyTemplates: NonNullable<Txn['anomaly']>[] = [
    { title: 'Duplicate invoice detected', severity: 'High',   note: 'Invoice matches an earlier one line-for-line' },
    { title: 'Price above contract rate',  severity: 'High',   note: 'Unit rate billed higher than the agreed contract' },
    { title: 'Split PO to dodge approval', severity: 'Medium', note: 'Multiple POs raised the same day under the limit' },
    { title: 'Off-contract maverick buy',  severity: 'Medium', note: 'Bought outside the preferred vendor list' },
    { title: 'Delivery short-received',    severity: 'Low',    note: 'Received quantity is under the ordered quantity' },
    { title: 'Unusual price spike',        severity: 'Low',    note: 'Line price well above the 3-month average' },
  ];
  const byAmount = txns.map((_, idx) => idx).sort((a, b) => txns[b].amount - txns[a].amount);
  [3, 20, 45, 90, 160, 250].forEach((pos, k) => { if (byAmount[pos] != null) txns[byAmount[pos]].anomaly = anomalyTemplates[k]; });
  return txns;
})();

// Recompute the entire dashboard from the ledger for a given filter combination.
function deriveDashboard(txns: Txn[], f: { from: number; to: number; branch: string; dept: string; category: string }) {
  const a = Math.min(f.from, f.to), b = Math.max(f.from, f.to);
  const catMatch = (t: Txn) =>
    (f.branch === 'All' || t.branch === f.branch) &&
    (f.dept === 'All' || t.department === f.dept) &&
    (f.category === 'All' || t.category === f.category);
  const full = txns.filter(t => catMatch(t) && t.month >= a && t.month <= b);   // date + categorical
  const catAll = txns.filter(catMatch);                                          // categorical only (for sparklines / prev)
  const sum = (arr: Txn[], sel: (t: Txn) => number) => arr.reduce((s, t) => s + sel(t), 0);

  // Monthly series across all 7 months with the categorical filters applied.
  const monthly = (sel: (arr: Txn[]) => number) => DASH_MONTHS.map((_, m) => sel(catAll.filter(t => t.month === m)));
  const mSpend = monthly(arr => sum(arr, t => t.amount) / 1e7);   // ₹ Cr
  const mSavings = monthly(arr => sum(arr, t => t.savings) / 1e5); // ₹ Lakh
  const mCycle = monthly(arr => (arr.length ? sum(arr, t => t.cycleDays) / arr.length : 0));
  const mAnoms = monthly(arr => arr.filter(t => t.anomaly).length);
  const winSum = (series: number[], lo: number, hi: number) => (lo > hi ? 0 : series.slice(lo, hi + 1).reduce((s, v) => s + v, 0));
  const len = b - a + 1;
  const pA = Math.max(0, a - len), pB = a - 1;

  const spend = sum(full, t => t.amount) / 1e7;
  const budget = sum(full, t => t.budget) / 1e7;
  const savings = sum(full, t => t.savings) / 1e5;
  const savingsPct = spend > 0 ? (savings * 1e5) / (spend * 1e7) * 100 : 0;
  const cycleAvg = full.length ? sum(full, t => t.cycleDays) / full.length : 0;
  const anomAll = full.filter(t => t.anomaly);
  const budgetUsed = budget > 0 ? (spend / budget) * 100 : 0;
  const prevCycleArr = catAll.filter(t => t.month >= pA && t.month <= pB);

  const groupBy = (key: (t: Txn) => string, universe: string[], yoy: Record<string, number>): BreakdownRow[] =>
    universe.map(label => {
      const rows = full.filter(t => key(t) === label);
      const value = sum(rows, t => t.amount) / 1e7;
      return { label, value, prev: value / (1 + (yoy[label] ?? 0)), meta: `${rows.length} orders` };
    }).filter(r => r.value > 0);

  const vendorNames = Array.from(new Set(full.map(t => t.vendor)));
  const topVendors = vendorNames.map(name => {
    const rows = full.filter(t => t.vendor === name);
    const trend = [];
    for (let m = a; m <= b; m++) trend.push(sum(rows.filter(t => t.month === m), t => t.amount) / 1e7);
    return {
      name, spend: sum(rows, t => t.amount) / 1e7, orders: rows.length,
      savings: sum(rows, t => t.savings) / 1e5,
      onTime: rows.length ? Math.round((rows.filter(t => t.onTime).length / rows.length) * 100) : 0,
      rating: VENDOR_RATING[name] ?? 4.4,
      trend: trend.length > 1 ? trend : [0, trend[0] ?? 0],
    };
  }).sort((x, y) => y.spend - x.spend).slice(0, 6);

  const stageDefs = [
    { label: 'Request → Approval', p: 0.10 }, { label: 'Approval → Sourcing', p: 0.18 },
    { label: 'Sourcing → PO', p: 0.29 }, { label: 'PO → Receipt', p: 0.35 }, { label: 'Receipt → Payment', p: 0.08 },
  ];
  const cyclePrev = cycleAvg * 1.75;
  const cycleStages = stageDefs.map(s => ({ label: s.label, days: +(cycleAvg * s.p).toFixed(1), prevDays: +(cyclePrev * s.p).toFixed(1) }));

  const pctOf = (sel: (t: Txn) => boolean) => (full.length ? Math.round((full.filter(sel).length / full.length) * 100) : 0);
  const compliance = [
    { label: 'On contract', pct: pctOf(t => t.onContract), target: 80 },
    { label: '3-way matched', pct: pctOf(t => t.matched), target: 95 },
    { label: 'Within policy', pct: pctOf(t => t.withinPolicy), target: 90 },
    { label: 'Competitive bid', pct: pctOf(t => t.competitive), target: 85 },
  ];

  const months = DASH_MONTHS.slice(a, b + 1).map((label, i) => ({
    label, value: +mSpend[a + i].toFixed(3),
    budget: +(sum(full.filter(t => t.month === a + i), t => t.budget) / 1e7).toFixed(3),
  }));

  return {
    rangeLabel: `${DASH_MONTHS[a]}–${DASH_MONTHS[b]}`,
    fullRange: a === 0 && b === DASH_MONTHS.length - 1,
    noCat: f.branch === 'All' && f.dept === 'All' && f.category === 'All',
    months, over: months.some(m => m.value > m.budget),
    spend, budget, budgetUsed, savings, savingsPct, cycleAvg, poCount: full.length, vendors: vendorNames.length,
    anomCount: anomAll.length, anomTotalL: sum(anomAll, t => t.amount) / 1e5,
    anomalies: [...anomAll].sort((x, y) => y.amount - x.amount).slice(0, 6).map(t => ({
      title: t.anomaly!.title, severity: t.anomaly!.severity, note: t.anomaly!.note,
      vendor: t.vendor, branch: t.branch, amount: `₹${(t.amount / 1e5).toFixed(2)} L`,
    })),
    spark: { spend: mSpend, savings: mSavings, cycle: mCycle, anomalies: mAnoms },
    prev: {
      spend: winSum(mSpend, pA, pB) || spend,
      savings: winSum(mSavings, pA, pB) || savings,
      cycle: prevCycleArr.length ? sum(prevCycleArr, t => t.cycleDays) / prevCycleArr.length : cycleAvg,
      anomalies: winSum(mAnoms, pA, pB),
    },
    byBranch: groupBy(t => t.branch, DASH_BRANCHES, BRANCH_YOY),
    byDept: groupBy(t => t.department, DASH_DEPTS, DEPT_YOY),
    byCategory: groupBy(t => t.category, DASH_CATS, CAT_YOY),
    levers: DASH_LEVERS.map(label => ({
      label, value: sum(full.filter(t => t.lever === label), t => t.savings) / 1e5,
      meta: `${full.filter(t => t.lever === label && t.savings > 0).length} deals`,
    })).filter(r => r.value > 0) as BreakdownRow[],
    topVendors, cycleStages, compliance,
  };
}

/* ===================================================================
   Reusable data-display primitives
   Used by the dashboard, and by KPI tiles across every scene.
   =================================================================== */

const reduceMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Eases a number toward `target`, easeOutCubic. It runs from zero on mount but
 * from wherever it currently sits on later changes, so a KPI that updates while
 * the demo runs (an approval landing, a request being raised) ticks across to
 * the new figure instead of snapping back to zero and re-counting.
 */
function useCountUp(target: number, duration = 1100) {
  const [v, setV] = useState(() => (reduceMotion() ? target : 0));
  const from = useRef(reduceMotion() ? target : 0);
  useEffect(() => {
    if (reduceMotion()) { setV(target); from.current = target; return; }
    const start = from.current;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / duration, 1);
      const val = start + (target - start) * (1 - Math.pow(1 - p, 3));
      from.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/**
 * Counts the first number inside an already-formatted value up from zero and
 * leaves the surrounding text alone: "₹4.58 Cr" keeps its symbol and unit,
 * "72,000" keeps its grouping, "6.4" keeps its decimal. A value with no number
 * in it (e.g. "TBD") renders unchanged.
 */
function CountUp({ value, duration = 1100 }: { value: string | number; duration?: number }) {
  const raw = String(value);
  const m = raw.match(/-?[\d,]*\.?\d+/);
  const parsed = m ? Number(m[0].replace(/,/g, '')) : NaN;
  const live = useCountUp(Number.isFinite(parsed) ? parsed : 0, duration);
  if (!m || !Number.isFinite(parsed)) return <>{raw}</>;
  const decimals = (m[0].split('.')[1] ?? '').length;
  const shown = m[0].includes(',')
    ? live.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : live.toFixed(decimals);
  const at = m.index ?? 0;
  return <>{raw.slice(0, at)}{shown}{raw.slice(at + m[0].length)}</>;
}

// Tiny trend line with a soft fill — sits inside KPI tiles and vendor rows.
function Sparkline({ data, stroke = '#fff', className = '' }: { data: number[]; stroke?: string; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const W = 100, H = 26, PAD = 3;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((d, i) => [
    (i / Math.max(data.length - 1, 1)) * W,
    H - PAD - ((d - min) / span) * (H - PAD * 2),
  ] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`sp${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#sp${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round"
        strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Period-over-period change chip. `lowerIsBetter` flips the colour for metrics
// like cycle time and anomaly count, where a fall is the win.
function DeltaChip({ curr, prev, lowerIsBetter = false, onDark = false }: {
  curr: number; prev: number; lowerIsBetter?: boolean; onDark?: boolean;
}) {
  if (!prev) return null;
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const tone = onDark
    ? (good ? 'text-emerald-200 bg-white/15' : 'text-rose-200 bg-white/15')
    : (good ? 'text-pos bg-pos/10' : 'text-neg bg-neg/10');
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${tone}`}>
      <Icon className="h-3 w-3" />{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Actual-vs-budget trend. Hovering a month lifts that column and shows the
// exact pair — the chart is the drill-down, so no separate table is needed.
function TrendArea({ data, prefix = '₹', suffix = ' Cr' }: {
  data: { label: string; value: number; budget: number }[]; prefix?: string; suffix?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 200, L = 10, R = 10, T = 16, B = 28;
  const max = Math.max(...data.map(d => Math.max(d.value, d.budget))) * 1.18;
  const x = (i: number) => L + (i / Math.max(data.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (key: 'value' | 'budget') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const active = hover === null ? data.length - 1 : hover;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" role="img" aria-label="Monthly spend against budget">
        <defs>
          <linearGradient id={`ta${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6356A8" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#6356A8" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`tl${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6356A8" /><stop offset="55%" stopColor="#6356A8" /><stop offset="100%" stopColor="#6356A8" />
          </linearGradient>
        </defs>
        {/* horizontal guides */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={L} x2={W - R} y1={T + f * (H - T - B)} y2={T + f * (H - T - B)}
            stroke="rgb(var(--border-color))" strokeWidth="1" />
        ))}
        {/* budget reference */}
        <path d={path('budget')} fill="none" stroke="rgb(var(--text-faint))" strokeWidth="1.6"
          strokeDasharray="5 4" strokeLinecap="round" />
        {/* actual */}
        <path d={`${path('value')} L${x(data.length - 1)},${H - B} L${x(0)},${H - B} Z`} fill={`url(#ta${gid})`} />
        <path d={path('value')} fill="none" stroke={`url(#tl${gid})`} strokeWidth="2.6"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* active column + points */}
        <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} stroke="rgb(var(--accent-analytics))"
          strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={i === active ? 5 : 3}
            fill="#fff" stroke="#6356A8" strokeWidth={i === active ? 3 : 2} />
        ))}
        {/* hover targets */}
        {data.map((d, i) => (
          <rect key={`h${i}`} x={x(i) - (W - L - R) / (data.length * 2)} y={0}
            width={(W - L - R) / data.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        {data.map((d, i) => (
          <text key={`t${i}`} x={x(i)} y={H - 8} textAnchor="middle"
            className="fill-textFaint" style={{ fontSize: 11, fontWeight: 600 }}>{d.label}</text>
        ))}
      </svg>
      {/* read-out for the active month */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1 text-xs">
        <span className="font-bold text-textPrimary font-outfit">{data[active].label}</span>
        <span className="flex items-center gap-1.5 text-textSecondary">
          <span className="h-2 w-2 rounded-full" style={{ background: '#6356A8' }} />
          Actual <b className="text-textPrimary tabular-nums">{prefix}{data[active].value.toFixed(2)}{suffix}</b>
        </span>
        <span className="flex items-center gap-1.5 text-textSecondary">
          <span className="h-0.5 w-3 rounded-full bg-textFaint" />
          Budget <b className="text-textPrimary tabular-nums">{prefix}{data[active].budget.toFixed(2)}{suffix}</b>
        </span>
        <DeltaChip curr={data[active].value} prev={data[active].budget} lowerIsBetter />
        <span className="text-textFaint text-[11px] ml-auto hidden sm:inline">hover a month to inspect</span>
      </div>
    </div>
  );
}

// Ranked breakdown: share bar, absolute value, share-of-total and movement,
// so one row answers "how big", "how much of the pie" and "which way".
function BreakdownBars({ rows, prefix = '₹', suffix = ' Cr', tint = '#6356A8', decimals = 2 }: {
  rows: BreakdownRow[]; prefix?: string; suffix?: string; tint?: string; decimals?: number;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, r) => s + r.value, 0) || 1;
  const max = Math.max(...sorted.map(r => r.value), 1);
  return (
    <div className="space-y-3">
      {sorted.map((r, i) => (
        <div key={r.label}>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold text-textFaint tabular-nums w-3">{i + 1}</span>
            <span className="text-xs font-semibold text-textPrimary truncate">{r.label}</span>
            {r.meta && <span className="text-[10px] text-textFaint truncate hidden md:inline">{r.meta}</span>}
            <span className="ml-auto text-xs font-bold tabular-nums text-textPrimary whitespace-nowrap">
              {prefix}{r.value.toFixed(decimals)}{suffix}
            </span>
            <DeltaChip curr={r.value} prev={r.prev ?? 0} />
          </div>
          <div className="flex items-center gap-2 mt-1 pl-5">
            <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${(r.value / max) * 100}%`, background: tint }} />
            </div>
            <span className="text-[10px] font-bold tabular-nums text-textFaint w-10 text-right">
              {((r.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Semicircular budget gauge. pathLength normalises the arc to 100 so the
// dash array is just the percentage.
function GaugeArc({ used, total, prefix = '₹', suffix = ' Cr' }: {
  used: number; total: number; prefix?: string; suffix?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const pct = Math.min((used / total) * 100, 100);
  const live = useCountUp(pct, 1200);
  const D = 'M18 80 A62 62 0 0 1 142 80';
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 160 92" className="w-52">
          <defs>
            <linearGradient id={`ga${gid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6356A8" /><stop offset="55%" stopColor="#6356A8" /><stop offset="100%" stopColor="#6356A8" />
            </linearGradient>
          </defs>
          <path d={D} fill="none" stroke="rgb(var(--bg-secondary))" strokeWidth="14" strokeLinecap="round" />
          <path d={D} fill="none" stroke={`url(#ga${gid})`} strokeWidth="14" strokeLinecap="round"
            pathLength={100} strokeDasharray={`${live} 100`} />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <span className="text-3xl font-extrabold font-outfit text-textPrimary tabular-nums leading-none">
            {live.toFixed(1)}%
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint mt-1">of budget used</span>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs">
        <span className="text-textSecondary">Spent <b className="text-textPrimary tabular-nums">{prefix}{used.toFixed(2)}{suffix}</b></span>
        <span className="text-textSecondary">Left <b className="text-pos tabular-nums">{prefix}{(total - used).toFixed(2)}{suffix}</b></span>
      </div>
    </div>
  );
}

export default function App() {
  // Global States
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const [activeScene, setActiveScene] = useState<number>(() => {
    const sc = Number(params?.get('scene'));
    return sc >= 1 && sc <= 19 ? sc : 1;
  });
  // --- Dark theme disabled — light (Aurora) theme only for now. ---
  // To re-enable: restore the stateful darkMode block (see git history) and
  // un-comment the "Appearance" toggle in the sidebar below. The `.dark` rules
  // in index.css stay inert while this is false.
  // const [darkMode, setDarkMode] = useState<boolean>(() => {
  //   const q = params?.get('theme');
  //   if (q === 'light') return false;
  //   if (q === 'dark') return true;
  //   try {
  //     const saved = localStorage.getItem('smartspend-theme-v2');
  //     if (saved) return saved === 'dark';
  //   } catch { /* ignore */ }
  //   return false; // default to the light theme
  // });
  const darkMode = false; // force light theme
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [userRole, setUserRole] = useState<string>("Employee"); // Employee, Manager, SCM Buyer, Vendor, CEO

  // Apply the active theme by toggling the `dark` class on <html>. With dark
  // mode disabled this always resolves to light and also clears any stale
  // `dark` class / preference left in localStorage from a previous session.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('smartspend-theme-v2', darkMode ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [darkMode]);

  // Post-PO simulation states
  const [grnGenerated, setGrnGenerated] = useState<boolean>(false);
  const [billPosted, setBillPosted] = useState<boolean>(false);
  const [paymentComplete, setPaymentComplete] = useState<boolean>(false);
  const [deliveredQty, setDeliveredQty] = useState<number>(20);
  const [qualityPassed, setQualityPassed] = useState<boolean>(true);
  const [paymentMethod, setPaymentMethod] = useState<string>("Bank Transfer");
  // What comes off the bill before the vendor is paid. Both are editable: the
  // rate a bill attracts is a judgement made on the bill, not a constant, and
  // retention or a penalty has no rate at all.
  const [tdsRate, setTdsRate] = useState<number>(TDS.rate);
  const [otherDeduction, setOtherDeduction] = useState<number>(0);
  const [otherLabel, setOtherLabel] = useState<string>("Other amount");
  // The bank's reference for the transfer, recorded against the request.
  const [paymentNote, setPaymentNote] = useState<string>("");

  // Shared Data Model representing Odoo's live state
  const [requests, setRequests] = useState<RequestItem[]>([
    {
      id: "PR-2026-089",
      productName: "Dell Latitude 5440 Laptops",
      productQty: 60,
      targetPrice: 70000,
      totalCost: 1606000,
      lineItems: [
        { productName: "Dell Latitude 5440 Laptop", productQty: 20, targetPrice: 70000 },
        { productName: "USB-C Docking Station", productQty: 20, targetPrice: 8500 },
        { productName: "Laptop Backpack", productQty: 20, targetPrice: 1800 },
      ],
      location: "Bangalore Office",
      department: "IT & Infrastructure",
      expenseCategory: "IT Hardware & Laptops",
      status: "Pending Approval",
      urgency: "High",
      createdDate: "July 08, 08:30",
      deliveryDate: "Jul 18, 2026",
      buyer: "SCM-IT-14",
      vendor: "Primus Technologies",
      savings: 60000,
      history: [
        { title: "Request Submitted", date: "July 08, 08:30", desc: "Initiated by Anjitha V via conversational entry" },
        { title: "Budget Checked", date: "July 08, 08:32", desc: "Verified against Q3 IT Hardware allocation" }
      ],
      clarificationComments: [],
      vendorBids: [
        { vendorName: "Primus Technologies", price: 68000, leadTime: "5 Days", warranty: "3 Years On-Site", status: "Recommended" },
        { vendorName: "Apex Systems", price: 71000, leadTime: "10 Days", warranty: "1 Year Carry-In", status: "Qualified" }
      ],
      selectedSourcingMethod: "Multi RFQ",
      attachments: ["hardware_specifications.pdf"]
    },
    {
      id: "PR-2026-077",
      productName: "Ergonomic Office Chairs",
      productQty: 10,
      targetPrice: 8000,
      totalCost: 80000,
      location: "Kochi Head Office",
      department: "Facilities",
      expenseCategory: "Office Furniture",
      status: "PO Confirmed",
      urgency: "Medium",
      createdDate: "July 05, 11:20",
      deliveryDate: "Jul 12, 2026",
      buyer: "SCM-FUR-03",
      vendor: "Apex Systems",
      savings: 5000,
      history: [
        { title: "Request Submitted", date: "July 05, 11:20", desc: "Submitted by Anjitha V" },
        { title: "Approved by Manager", date: "July 05, 14:15", desc: "Approved by Operations Director" },
        { title: "PO Created: PO-2026-003", date: "July 05, 15:00", desc: "Auto-generated & sent to Apex Systems" }
      ],
      clarificationComments: [],
      vendorBids: [
        { vendorName: "Apex Systems", price: 8000, leadTime: "3 Days", warranty: "2 Years", status: "Selected" }
      ],
      selectedSourcingMethod: "Negotiation",
      attachments: []
    },
    {
      id: "PR-2026-092",
      productName: "19-Inch Data Server Racks",
      productQty: 2,
      targetPrice: 120000,
      totalCost: 240000,
      location: "Mumbai Office",
      department: "IT & Infrastructure",
      expenseCategory: "Datacenter Equipment",
      status: "Sourcing",
      urgency: "High",
      createdDate: "July 09, 09:15",
      deliveryDate: "Jul 20, 2026",
      buyer: "SCM-IT-14",
      vendor: "Pending Sourcing",
      savings: 0,
      history: [
        { title: "Request Submitted", date: "July 09, 09:15", desc: "Initiated via search bar" },
        { title: "Budget Checked", date: "July 09, 09:16", desc: "Verified &amp; Reserved" },
        { title: "Sourcing Triggered", date: "July 09, 09:18", desc: "No active rate contract found. Rerouted to SCM buyer." }
      ],
      clarificationComments: [],
      vendorBids: [
        { vendorName: "Primus Technologies", price: 125000, leadTime: "7 Days", warranty: "3 Years", status: "Submitted" }
      ],
      selectedSourcingMethod: "Multi RFQ",
      attachments: []
    },
    {
      id: "PR-2026-095", productName: "Adobe Creative Cloud Licenses", productQty: 25, targetPrice: 4200,
      totalCost: 105000, location: "Delhi Office", department: "Marketing", expenseCategory: "Software Licenses",
      status: "Approved", urgency: "Medium", createdDate: "Jul 10, 10:05", deliveryDate: "Jul 15, 2026",
      buyer: "SCM-SW-08", vendor: "Adobe India", savings: 12000,
      history: [{ title: "Request Submitted", date: "Jul 10, 10:05" }, { title: "Approved by Manager", date: "Jul 10, 13:20", desc: "Approved by Marketing Head" }],
      clarificationComments: [], vendorBids: [{ vendorName: "Adobe India", price: 4200, leadTime: "Instant", warranty: "1 Year", status: "Selected" }],
      selectedSourcingMethod: "Negotiation", attachments: ["license_quote.pdf"]
    },
    {
      id: "PR-2026-101", productName: "Industrial UPS Units", productQty: 4, targetPrice: 85000,
      totalCost: 340000, location: "Mumbai Office", department: "Operations", expenseCategory: "Datacenter Equipment",
      status: "Pending Approval", urgency: "High", createdDate: "Jul 11, 09:40", deliveryDate: "Jul 25, 2026",
      buyer: "SCM-IT-14", vendor: "PowerGrid Solutions", savings: 22000,
      history: [{ title: "Request Submitted", date: "Jul 11, 09:40" }, { title: "Budget Checked", date: "Jul 11, 09:42", desc: "Verified against Ops capex" }],
      clarificationComments: [], vendorBids: [{ vendorName: "PowerGrid Solutions", price: 83000, leadTime: "8 Days", warranty: "3 Years", status: "Recommended" }, { vendorName: "VoltEdge", price: 88000, leadTime: "6 Days", warranty: "2 Years", status: "Qualified" }],
      selectedSourcingMethod: "Multi RFQ", attachments: ["ups_specs.pdf", "site_layout.pdf"]
    },
    {
      id: "PR-2026-104", productName: "Marketing Event Booth Setup", productQty: 1, targetPrice: 180000,
      totalCost: 180000, location: "Bangalore Office", department: "Marketing", expenseCategory: "Professional Services",
      status: "Sourcing", urgency: "Medium", createdDate: "Jul 12, 14:20", deliveryDate: "Aug 02, 2026",
      buyer: "SCM-MKT-02", vendor: "Pending Sourcing", savings: 0,
      history: [{ title: "Request Submitted", date: "Jul 12, 14:20" }, { title: "Sourcing Triggered", date: "Jul 12, 14:25", desc: "Routed to SCM buyer for RFQ" }],
      clarificationComments: [], vendorBids: [{ vendorName: "EventCraft", price: 178000, leadTime: "15 Days", warranty: "NA", status: "Submitted" }],
      selectedSourcingMethod: "Multi RFQ", attachments: ["booth_brief.pdf"]
    },
    {
      id: "PR-2026-108", productName: "Pantry & Housekeeping Supplies (Q3)", productQty: 1, targetPrice: 65000,
      totalCost: 65000, location: "Chennai Office", department: "Facilities", expenseCategory: "MRO Supplies",
      status: "PO Confirmed", urgency: "Low", createdDate: "Jul 06, 16:10", deliveryDate: "Jul 14, 2026",
      buyer: "SCM-FUR-03", vendor: "CleanServe", savings: 4000,
      history: [{ title: "Request Submitted", date: "Jul 06, 16:10" }, { title: "PO Created: PO-2026-011", date: "Jul 06, 17:30", desc: "Sent to CleanServe" }],
      clarificationComments: [], vendorBids: [{ vendorName: "CleanServe", price: 65000, leadTime: "4 Days", warranty: "NA", status: "Selected" }],
      selectedSourcingMethod: "Negotiation", attachments: []
    },
    {
      id: "PR-2026-112", productName: "Standing Desks (Ergonomic)", productQty: 15, targetPrice: 22000,
      totalCost: 330000, location: "Kochi Head Office", department: "Facilities", expenseCategory: "Office Furniture",
      status: "Pending Approval", urgency: "Medium", createdDate: "Jul 13, 11:00", deliveryDate: "Jul 28, 2026",
      buyer: "SCM-FUR-03", vendor: "ErgoWorks", savings: 18000,
      history: [{ title: "Request Submitted", date: "Jul 13, 11:00" }, { title: "Budget Checked", date: "Jul 13, 11:03", desc: "Verified against Facilities budget" }],
      clarificationComments: [], vendorBids: [{ vendorName: "ErgoWorks", price: 21500, leadTime: "12 Days", warranty: "5 Years", status: "Recommended" }, { vendorName: "DeskPro", price: 23000, leadTime: "9 Days", warranty: "3 Years", status: "Qualified" }],
      selectedSourcingMethod: "Multi RFQ", attachments: ["ergo_catalog.pdf"]
    },
    {
      id: "PR-2026-115", productName: "Next-Gen Firewall Appliances", productQty: 3, targetPrice: 145000,
      totalCost: 435000, location: "Bangalore Office", department: "IT & Infrastructure", expenseCategory: "Datacenter Equipment",
      status: "Needs Clarification", urgency: "High", createdDate: "Jul 14, 08:50", deliveryDate: "Jul 30, 2026",
      buyer: "SCM-IT-14", vendor: "SecureNet", savings: 0,
      history: [{ title: "Request Submitted", date: "Jul 14, 08:50" }, { title: "Info Requested", date: "Jul 14, 10:15", desc: "Manager asked for clarification" }],
      clarificationComments: [{ role: "manager", text: "Do these replace the existing units or are they additions to capacity?", date: "Jul 14, 10:15" }],
      vendorBids: [{ vendorName: "SecureNet", price: 143000, leadTime: "10 Days", warranty: "3 Years", status: "Submitted" }],
      selectedSourcingMethod: "Multi RFQ", attachments: ["network_diagram.pdf"]
    }
  ]);

  // ?api=https://… wins over the stored value, so one hosted build can be
  // pointed at a tunnelled Odoo for a live demo without being rebuilt.
  const [odooApiUrl, setOdooApiUrl] = useState<string>(() => {
    try {
      return resolveApiUrl(window.location.search, localStorage.getItem("erpApiUrl"));
    } catch {
      return DEFAULT_API_URL;
    }
  });
  const [odooConnected, setOdooConnected] = useState<boolean>(false);
  // Calls Odoo did not accept. The portal carries on when one fails — an edit
  // stays in the browser, a decision or a purchase order falls back to a local
  // simulation so the walkthrough still runs — so without this the screen
  // quietly stops matching the backend. Anything listed here is a change Odoo
  // does NOT have. Keyed by action so a failed save and a failed approval on
  // the same request are two separate rows, each retried on its own.
  interface SyncError { key: string; id: string; what: string; message: string; retry: () => void }
  const [syncErrors, setSyncErrors] = useState<SyncError[]>([]);
  const noteSyncError = (err: SyncError) =>
    setSyncErrors(prev => [...prev.filter(e => e.key !== err.key), err]);
  const clearSyncError = (key: string) =>
    setSyncErrors(prev => prev.filter(e => e.key !== key));

  /** Why Odoo turned a call down — it answers {"error": "..."} with a real status. */
  const refusalMessage = async (res: Response) => {
    const failure = await res.json().catch(() => ({} as any));
    return (failure?.error as string) || `The server refused this (HTTP ${res.status}).`;
  };
  /**
   * Why a call never landed. A TypeError is fetch failing to connect at all —
   * "Failed to fetch" means nothing to a requester, so say it the way the
   * sign-in screen already does. Any other Error carries its own message (a 401
   * has already cleared the session and this screen is about to be sign-in).
   */
  const unreachableMessage = (e: unknown, url: string) =>
    e instanceof TypeError ? `Could not reach ${url}. Is the server running?`
      : e instanceof Error ? e.message
        : `Could not reach ${url}.`;
  // Appended when the portal went ahead with a local result anyway, so the
  // screen and Odoo are knowingly out of step until the retry succeeds.
  const SIMULATED = ' This screen is showing a local result — the server still holds the previous state.';
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string>("PR-2026-089");
  const [currentOdooRequestName, setCurrentOdooRequestName] = useState<string>("New");
  const lastOdooSyncRef = useRef<string>("");

  // ---- Authentication -------------------------------------------------
  // The API uses Odoo's bearer-token auth: every data call must carry
  // `Authorization: Bearer <token>`. The token is obtained from /login and
  // held in localStorage so a page refresh doesn't sign the user out.
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try { return localStorage.getItem("smartspend-token"); } catch { return null; }
  });
  const [currentUser, setCurrentUser] = useState<OdooUser | null>(() => {
    try {
      const raw = localStorage.getItem("smartspend-user");
      return raw ? (JSON.parse(raw) as OdooUser) : null;
    } catch { return null; }
  });
  const [authError, setAuthError] = useState<string>("");
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  // A session with no Odoo behind it: sign-in could not connect, so the portal
  // signed in locally and runs on its seeded data. Every call below returns
  // without touching the network, and the local fallbacks the callers already
  // carry run the walkthrough — which is what they were written for.
  const offlineDemo = authToken === OFFLINE_TOKEN;
  // Whether the first load of requests for the current session has finished.
  // Until it has, `requests` still holds the built-in walkthrough set, and an
  // inbox built from that would miss the request the approver actually came
  // for — the whole complaint about not finding the latest one.
  const [requestsSynced, setRequestsSynced] = useState<boolean>(false);
  // What the sign-in form on the landing screen holds. The portal used to let
  // anyone pick a role from four buttons; now you sign in as the Odoo user for
  // that role and the role comes from the groups that account actually holds.
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");

  const clearSession = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setOdooConnected(false);
    setMasterData(null);
    try {
      localStorage.removeItem("smartspend-token");
      localStorage.removeItem("smartspend-user");
    } catch { /* ignore */ }
  };

  /**
   * fetch() wrapper for the SmartSpend API.
   * Attaches the bearer token, and signs the user out on 401 so an expired
   * token surfaces as the login screen rather than silent empty data.
   */
  const apiFetch = async (
    path: string,
    init: RequestInit = {},
    url: string = odooApiUrl,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${url}${path}`, { ...init, headers });
    if (res.status === 401) {
      clearSession();
      throw new Error("Session expired — please sign in again.");
    }
    return res;
  };

  const signIn = async (loginName: string, password: string): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const res = await fetch(`${odooApiUrl}/api/smartspend/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginName, password }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setAuthError(data?.error || "Sign in failed.");
        return false;
      }
      setAuthToken(data.token);
      setCurrentUser(data.user);
      try {
        localStorage.setItem("smartspend-token", data.token);
        localStorage.setItem("smartspend-user", JSON.stringify(data.user));
      } catch { /* ignore */ }
      // Sign in as who Odoo says you are, not as whoever the dropdown last held.
      if (data.user?.defaultRole) handleSsoLogin(data.user.defaultRole);
      loadMasterData(odooApiUrl, data.token);
      return true;
    } catch {
      // Odoo is not there at all. On a hosted build that is the normal case —
      // there is no backend to reach — so rather than holding the visitor at a
      // gate they cannot pass, sign them in locally and run the walkthrough on
      // the seeded data. The screen says plainly that nothing is being saved.
      const demoUser = resolveDemoUser(loginName, password);
      if (demoUser) {
        setAuthToken(OFFLINE_TOKEN);
        setCurrentUser(demoUser);
        setAuthError("");
        // Remembered the same way a real sign-in is, or a reload would find no
        // session and send the visitor back to the gate.
        try {
          localStorage.setItem("smartspend-token", OFFLINE_TOKEN);
          localStorage.setItem("smartspend-user", JSON.stringify(demoUser));
        } catch { /* ignore */ }
        if (demoUser.defaultRole) handleSsoLogin(demoUser.defaultRole);
        return true;
      }
      setAuthError(
        `Could not reach ${odooApiUrl}. Is the server running? ` +
        `Without it you can still explore the demo — sign in as manager@smartspend.demo / manager.`);
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    // Nothing was ever opened on the backend, so there is nothing to close.
    if (offlineDemo) { clearSession(); return; }
    try {
      if (authToken) {
        // Revokes the API key server-side so a copied token can't be reused.
        await fetch(`${odooApiUrl}/api/smartspend/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
        });
      }
    } catch { /* best effort — clear locally regardless */ }
    clearSession();
  };

  // Re-read who the held token belongs to. A session stored before the backend
  // returned roles has none cached, and Odoo may have changed them since.
  const refreshCurrentUser = async (url: string = odooApiUrl, token: string | null = authToken) => {
    if (offlineDemo) return;
    if (!token) return;
    try {
      const res = await fetch(`${url}/api/smartspend/me`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const user = await res.json();
      setCurrentUser(user);
      try { localStorage.setItem("smartspend-user", JSON.stringify(user)); } catch { /* ignore */ }
    } catch (e) {
      console.warn("Could not refresh the signed-in user:", e);
    }
  };

  // Branches, departments and categories, straight from Odoo.
  const loadMasterData = async (url: string = odooApiUrl, token: string | null = authToken) => {
    // The fallback lists below are what the dropdowns use when this never runs.
    if (offlineDemo) return;
    if (!token) return;
    try {
      const res = await fetch(`${url}/api/smartspend/master-data`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) setMasterData(await res.json());
    } catch (e) {
      console.warn("Falling back to built-in lists — master data unreachable:", e);
    }
  };

  // Helper to fetch requests from Odoo backend
  const fetchRequestsFromOdoo = async (url: string = odooApiUrl) => {
    // Keep the seeded walkthrough set — there is nothing to replace it with.
    if (offlineDemo) return;
    if (!authToken) return null;
    try {
      const res = await apiFetch(`/api/smartspend/requests`, { method: 'GET' }, url);
      if (res.ok) {
        const data = await res.json();
        // The call succeeded, so the server is up — say so even when it answers
        // with nothing. A requester or vendor account legitimately sees an empty
        // list (the record rule shows them only their own requests), and marking
        // that "Disconnected" reported a healthy Odoo as down.
        setOdooConnected(true);
        if (Array.isArray(data) && data.length > 0) {
          lastOdooSyncRef.current = JSON.stringify(data);
          setRequests(data);
          return data;
        }
        // Nothing of their own yet — keep the seeded walkthrough requests so the
        // portal still has something to show.
        return null;
      }
      setOdooConnected(false);
    } catch (e) {
      console.warn("Failed to connect to the backend:", e);
      setOdooConnected(false);
    }
    return null;
  };

  // Helper to save/submit a request to Odoo backend
  const submitRequestToOdoo = async (reqItem: RequestItem, url: string = odooApiUrl) => {
    if (!authToken) return null;
    // The edit already stands in local state; there is nowhere to send it.
    if (offlineDemo) return null;
    // Retrying re-posts this very version. Any later edit re-runs the sync
    // effect, which replaces this row with one carrying the newer copy.
    const fail = (message: string) => noteSyncError({
      key: `save:${reqItem.id}`, id: reqItem.id, what: 'was not saved',
      message, retry: () => submitRequestToOdoo(reqItem, url),
    });
    try {
      const res = await apiFetch(`/api/smartspend/submit`, {
        method: 'POST',
        body: JSON.stringify(reqItem),
      }, url);
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => {
          const newState = prev.map(r => r.id === reqItem.id || r.id === updated.id ? updated : r);
          lastOdooSyncRef.current = JSON.stringify(newState);
          return newState;
        });
        setSelectedRequestId(prev => prev === reqItem.id ? updated.id : prev);
        clearSyncError(`save:${reqItem.id}`);
        return updated;
      }
      // Odoo refused it. Say so: the requester is the only one who can correct
      // the request, and nothing else on screen would ever tell them.
      const message = await refusalMessage(res);
      console.warn("The server refused the save:", message);
      fail(message);
    } catch (e) {
      console.warn("Failed to submit the request:", e);
      fail(unreachableMessage(e, url));
    }
    return null;
  };

  // Raise the real purchase order in Odoo for a request.
  // Returns the refreshed request (with its PO reference) or null when the
  // backend is unreachable or refuses — the caller then falls back to the
  // offline simulation so the walkthrough still runs without Odoo.
  const createPurchaseOrderInOdoo = async (reqId: string, url: string = odooApiUrl) => {
    if (!authToken) return null;
    // Nowhere to raise it, so the walkthrough raises its own — the same shape
    // the backend answers with, in the browser only. Unlike the calls above
    // this one has no local fallback in its caller: without this the demo
    // stops dead at "Generate Purchase Order".
    if (offlineDemo) {
      const current = requests.find(r => r.id === reqId);
      if (!current) return null;
      const raised = current.purchaseOrders?.length
        ? current.purchaseOrders
        : [`P${String(
            requests.reduce((n, r) => n + (r.purchaseOrders?.length ?? 0), 0) + 1,
          ).padStart(5, '0')}`];
      const updated: RequestItem = {
        ...current,
        status: 'PO Confirmed',
        purchaseOrders: raised,
        history: [...current.history, {
          title: `PO Created: ${raised.join(', ')}`, date: 'Now',
          desc: `Sent to ${current.vendor || 'the vendor'}.`,
        }],
      };
      setRequests(prev => prev.map(r => (r.id === reqId ? updated : r)));
      return updated;
    }
    const fail = (message: string) => noteSyncError({
      key: `po:${reqId}`, id: reqId, what: 'purchase order was not raised',
      message: message + SIMULATED, retry: () => createPurchaseOrderInOdoo(reqId, url),
    });
    try {
      const res = await apiFetch(`/api/smartspend/purchase-order`, {
        method: 'POST',
        body: JSON.stringify({ id: reqId }),
      }, url);
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => {
          const newState = prev.map(r => (r.id === reqId || r.id === updated.id ? updated : r));
          lastOdooSyncRef.current = JSON.stringify(newState);
          return newState;
        });
        clearSyncError(`po:${reqId}`);
        return updated as RequestItem;
      }
      const message = await refusalMessage(res);
      console.warn("The server refused to raise the purchase order:", message);
      fail(message);
    } catch (e) {
      console.warn("Failed to raise the purchase order:", e);
      fail(unreachableMessage(e, url));
    }
    return null;
  };

  /**
   * Record the purchase head's release, or the vendor's acknowledgment, in Odoo.
   *
   * Both steps are gated on the backend too — the group check there is what
   * actually decides, the portal only hides a button nobody may press.
   */
  const recordPurchaseOrderStep = async (
    reqId: string, step: 'release' | 'acknowledge', url: string = odooApiUrl,
  ) => {
    if (!authToken) return null;
    // Same again, and the same guards the backend applies — the steps run in
    // order whether or not there is an Odoo to enforce it.
    if (offlineDemo) {
      const current = requests.find(r => r.id === reqId);
      if (!current) return null;
      if (step === 'release' && !current.purchaseOrders?.length) return null;
      if (step === 'acknowledge' && !current.poReleased) return null;
      const updated: RequestItem = step === 'release'
        ? {
            ...current, poReleased: true,
            history: [...current.history, {
              title: 'Approved by Purchase Head', date: 'Now',
              desc: `${current.purchaseOrders?.join(', ') || 'The purchase order'} approved and released to vendor.`,
            }],
          }
        : {
            ...current, poAcknowledged: true,
            history: [...current.history, {
              title: 'Vendor Acknowledged PO', date: 'Now',
              desc: 'Vendor confirmed delivery commit date & pricing.',
            }],
          };
      setRequests(prev => prev.map(r => (r.id === reqId ? updated : r)));
      return updated;
    }
    const fail = (message: string) => noteSyncError({
      key: `po-step:${step}:${reqId}`, id: reqId,
      what: step === 'release'
        ? 'purchase order release was not recorded'
        : 'vendor acknowledgment was not recorded',
      message: message + SIMULATED,
      retry: () => recordPurchaseOrderStep(reqId, step, url),
    });
    try {
      const res = await apiFetch(`/api/smartspend/purchase-order/step`, {
        method: 'POST',
        body: JSON.stringify({ id: reqId, step }),
      }, url);
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => {
          const newState = prev.map(r => (r.id === reqId || r.id === updated.id ? updated : r));
          lastOdooSyncRef.current = JSON.stringify(newState);
          return newState;
        });
        clearSyncError(`po-step:${step}:${reqId}`);
        return updated as RequestItem;
      }
      const message = await refusalMessage(res);
      console.warn("The server refused the purchase order step:", message);
      fail(message);
    } catch (e) {
      console.warn("Failed to record the purchase order step:", e);
      fail(unreachableMessage(e, url));
    }
    return null;
  };

  // Helper to reset Odoo backend database
  const resetOdooDatabase = async (url: string = odooApiUrl) => {
    if (!authToken) return false;
    if (offlineDemo) return false;
    try {
      const res = await apiFetch(`/api/smartspend/reset`, { method: 'POST' }, url);
      if (res.ok) {
        await fetchRequestsFromOdoo(url);
        return true;
      }
    } catch (e) {
      console.warn("Failed to reset the demo database:", e);
    }
    return false;
  };

  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    setRequestsSynced(false);
    // Await the first load so the "waiting on you" inbox below is built from
    // what Odoo actually holds, not from the seeded walkthrough list that is on
    // screen until the fetch lands.
    void (async () => {
      await fetchRequestsFromOdoo();
      if (!cancelled) setRequestsSynced(true);
    })();
    loadMasterData();
    refreshCurrentUser();
    return () => { cancelled = true; };
  }, [odooApiUrl, authToken]);



  useEffect(() => {
    const requestsStr = JSON.stringify(requests);
    if (requestsStr === lastOdooSyncRef.current) {
      return;
    }
    let lastRequests: RequestItem[] = [];
    try {
      lastRequests = JSON.parse(lastOdooSyncRef.current);
    } catch {
      lastRequests = [];
    }
    lastOdooSyncRef.current = requestsStr;
    if (lastRequests.length === 0) {
      return;
    }
    for (const req of requests) {
      const oldReq = lastRequests.find(r => r.id === req.id);
      if (!oldReq || JSON.stringify(oldReq) !== JSON.stringify(req)) {
        submitRequestToOdoo(req);
      }
    }
  }, [requests]);
  
  // requests state has been relocated above the Odoo API helpers to satisfy TS scoping.

  const currentRequest = requests.find(r => r.id === selectedRequestId) || requests[0];
  // The rate-contract and budget screens used to run on two presenter switches.
  // When Odoo has an answer for this request, that answer is the starting point
  // — the switches stay, so the walkthrough can still show either outcome.
  useEffect(() => {
    if (!currentRequest) return;
    if (currentRequest.contract !== undefined) setHasContract(!!currentRequest.contract);
    if (currentRequest.budgetBreach !== undefined) setBudgetBreach(!!currentRequest.budgetBreach);
  }, [currentRequest?.id, currentRequest?.contract, currentRequest?.budgetBreach]);

  // Received quantity per requisition line (GRN) — keyed to the current request.
  const [deliveredQtys, setDeliveredQtys] = useState<number[]>([]);
  const currentLines = currentRequest ? reqLines(currentRequest) : [];
  const receivedLines: LineItem[] = currentLines.map((l, i) => ({ ...l, productQty: deliveredQtys[i] ?? l.productQty }));

  // A supplier sees orders, not requisitions: everything that has reached a
  // purchase order.
  const vendorOrderable = requests.filter(r =>
    r.purchaseOrders?.length || r.status === 'PO Confirmed' || r.status === 'Paid');
  // Narrowed to their own when the account can be matched to a supplier. The
  // sign-in carries the user's *company*, which is the buying entity on a real
  // backend and the supplier only on the seeded demo accounts — so it narrows
  // when it matches something and is ignored when it does not, rather than
  // showing a supplier an empty portal because the name did not line up.
  const vendorCompany = (currentUser?.company || '').trim();
  const vendorOwn = vendorCompany
    ? vendorOrderable.filter(r => (r.vendor || '').toLowerCase() === vendorCompany.toLowerCase())
    : [];
  const vendorOrders = vendorOwn.length ? vendorOwn : vendorOrderable;
  // Released to them and not yet answered — this is the queue that is theirs.
  const vendorAwaiting = vendorOrders.filter(r => r.poReleased && !r.poAcknowledged);
  const vendorApproved = vendorOrders.filter(r => r.poAcknowledged);
  // A delivery exists once the order has been acknowledged; a settled one has
  // been paid for.
  const vendorReceipts = vendorOrders.filter(r => r.poAcknowledged || r.status === 'Paid');
  // Worked out in one place: three screens show these and they must agree.
  const billGross = linesTotal(receivedLines);
  const tdsAmount = Math.round(billGross * tdsRate) / 100;
  const netPayable = Math.max(0, billGross - tdsAmount - otherDeduction);

  useEffect(() => {
    if (currentRequest) {
      setDeliveredQty(currentRequest.productQty);
      setDeliveredQtys(reqLines(currentRequest).map(l => l.productQty));
    }
  }, [selectedRequestId, currentRequest]);

  // Employee Portal Local States
  const [employeeTab, setEmployeeTab] = useState<'chat' | 'list' | 'tracking' | 'clarify'>('chat');
  // "My Requests" home filters — three coloured status dots + free-text search.
  const [homeStatusFilter, setHomeStatusFilter] = useState<string>('all');
  // Tiles or rows. Shared, so switching does not have to be done again on the
  // next tab.
  const [requestView, setRequestView] = useState<'grid' | 'list'>('grid');
  const [homeSearch, setHomeSearch] = useState('');
  // Search boxes on the manager approvals and buyer sourcing queues.
  const [mgrSearch, setMgrSearch] = useState('');
  const [scmSearch, setScmSearch] = useState('');
  // Spend dashboard date filter — inclusive from/to month (data runs Jan–Jul 2026).
  const DASH_MONTH_MIN = '2026-01';
  const DASH_MONTH_MAX = '2026-07';
  const [dashFrom, setDashFrom] = useState(DASH_MONTH_MIN);
  const [dashTo, setDashTo] = useState(DASH_MONTH_MAX);
  // Extra dashboard filters — focus the breakdown charts on one branch / department / category.
  const [dashBranch, setDashBranch] = useState('All');
  const [dashDept, setDashDept] = useState('All');
  const [dashCategory, setDashCategory] = useState('All');
  // Everything on the dashboard is derived live from the transaction ledger for
  // the current filter combination — true cross-filtering across all four filters.
  const dashToIdx = (v: string) => Math.min(Math.max(parseInt(v.slice(5, 7), 10) - 1, 0), DASH_MONTHS.length - 1);
  const dash = deriveDashboard(DASH_TXNS, { from: dashToIdx(dashFrom), to: dashToIdx(dashTo), branch: dashBranch, dept: dashDept, category: dashCategory });

  // Drag-to-reorder role nav; first item = landing screen on login (#5).
  // Role-keyed so Employee, SCM Buyer, Manager and CEO each persist their own order.
  const DEFAULT_NAV_ORDER: Record<string, string[]> = {
    Employee: ['chat', 'list', 'tracking', 'clarify'],
    Manager: ['queue', 'clarify', 'tracking', 'masters'],
    // 'tracking' is here because raising the PO moves the request to "PO
    // Confirmed", which drops it straight out of the To Source queue — and the
    // buyer had no other route to the tracking screen, so the vendor
    // acknowledgment step it owns became unreachable the moment it was due.
    'SCM Buyer': ['requests', 'auctions', 'discovery', 'tracking'],
    CEO: ['analytics', 'tracking', 'masters'],
  };
  const [navOrder, setNavOrder] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('smartspend-nav-order-v2');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string[]>;
        const merged: Record<string, string[]> = {};
        for (const role of Object.keys(DEFAULT_NAV_ORDER)) {
          const def = DEFAULT_NAV_ORDER[role];
          const s = parsed[role];
          merged[role] = Array.isArray(s) && s.length === def.length && def.every(v => s.includes(v)) ? s : def;
        }
        return merged;
      }
    } catch { /* ignore */ }
    return DEFAULT_NAV_ORDER;
  });
  const [dragKey, setDragKey] = useState<string | null>(null);
  useEffect(() => {
    try { localStorage.setItem('smartspend-nav-order-v2', JSON.stringify(navOrder)); } catch { /* ignore */ }
  }, [navOrder]);
  const reorderNav = (role: string, from: string, to: string) => {
    if (from === to) return;
    setNavOrder(prev => {
      const next = [...(prev[role] || [])];
      const fi = next.indexOf(from), ti = next.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      return { ...prev, [role]: next };
    });
  };
  // Navigate to a nav item's screen (shared by click + login landing).
  const applyNav = (role: string, key: string | undefined) => {
    if (!key) return;
    if (role === 'Employee') {
      if (key === 'masters') { setActiveScene(16); }
      else { setActiveScene(2); setEmployeeTab(key as 'chat' | 'list' | 'tracking' | 'clarify'); }
    }
    else if (role === 'Manager') {
      setActiveScene(key === 'masters' ? 16 : key === 'tracking' ? 11 : key === 'clarify' ? 17 : 10);
    }
    else if (role === 'SCM Buyer') {
      if (key === 'masters') { setActiveScene(16); }
      else if (key === 'tracking') {
        // Tracking has no request picker: it shows the selected request, or
        // falls back to the first in the list. Arriving cold — a fresh sign-in,
        // or straight off the sourcing queue — that fallback is an arbitrary
        // request rather than the order waiting to be acknowledged, which is
        // the whole reason the buyer comes here.
        const awaiting = newestFirst(requests.filter(r => r.status === 'PO Confirmed'));
        if (awaiting.length && !awaiting.some(r => r.id === selectedRequestId)) {
          setSelectedRequestId(awaiting[0].id);
        }
        setActiveScene(11);
      }
      else if (key === 'auctions') { setActiveScene(19); }
      else { setActiveScene(6); setScmTab(key === 'discovery' ? 'discovery' : 'requests'); }
    }
    else if (role === 'CEO') { setActiveScene(key === 'masters' ? 16 : key === 'tracking' ? 11 : 15); }
  };
  const navActive = (role: string, key: string): boolean => {
    if (role === 'Employee') return key === 'masters' ? activeScene === 16 : activeScene === 2 && employeeTab === key;
    if (role === 'Manager') return key === 'masters' ? activeScene === 16
      : key === 'tracking' ? activeScene === 11
        : key === 'clarify' ? activeScene === 17 : activeScene === 10;
    if (role === 'SCM Buyer') {
      if (key === 'masters') return activeScene === 16;
      if (key === 'tracking') return activeScene === 11;
      if (key === 'auctions') return activeScene === 19;
      return activeScene === 6 && scmTab === (key === 'discovery' ? 'discovery' : 'requests');
    }
    if (role === 'CEO') return key === 'masters' ? activeScene === 16 : key === 'tracking' ? activeScene === 11 : activeScene === 15;
    return false;
  };
  const navMeta = (role: string, key: string): { icon: React.ReactNode; label: string; badge?: React.ReactNode } => {
    const pill = (n: number, cls: string, pulse = false) => n > 0
      ? <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${cls} ${pulse ? 'animate-pulse' : ''}`}>{n}</span> : undefined;
    const m: Record<string, { icon: React.ReactNode; label: string; badge?: React.ReactNode }> = {
      'Employee/chat': { icon: <MessageSquare className="h-4 w-4" />, label: 'New Request' },
      'Employee/list': { icon: <FileText className="h-4 w-4" />, label: 'My Requests', badge: <span className="ml-auto bg-secondary text-textSecondary text-[10px] px-2 py-0.5 rounded-full font-bold">{requests.length}</span> },
      'Employee/tracking': { icon: <History className="h-4 w-4" />, label: 'Track Request' },
      'Employee/clarify': { icon: <AlertTriangle className="h-4 w-4" />, label: 'Questions', badge: pill(requests.filter(r => r.status === 'Needs Clarification').length, 'bg-gold/20 text-gold border border-gold/30', true) },
      'Employee/masters': { icon: <Boxes className="h-4 w-4" />, label: 'Master Data' },
      'Manager/queue': { icon: <CheckCircle2 className="h-4 w-4" />, label: 'To Approve', badge: pill(requests.filter(r => MANAGER_QUEUE_STATUSES.includes(r.status)).length, 'bg-gold/20 text-gold border border-gold/30') },
      'Manager/clarify': { icon: <AlertTriangle className="h-4 w-4" />, label: 'Questions', badge: pill(requests.filter(r => r.status === 'Needs Clarification').length, 'bg-gold/20 text-gold border border-gold/30', true) },
      'Manager/tracking': { icon: <History className="h-4 w-4" />, label: 'Track Request' },
      'Manager/masters': { icon: <Boxes className="h-4 w-4" />, label: 'Master Data', badge: pill(pendingDrafts.length, 'bg-brand/20 text-brand border border-brand/30', true) },
      'SCM Buyer/requests': { icon: <Briefcase className="h-4 w-4" />, label: 'To Source', badge: pill(requests.filter(r => BUYER_QUEUE_STATUSES.includes(r.status)).length, 'bg-brand/20 text-brand border border-brand/30') },
      'SCM Buyer/auctions': { icon: <Gavel className="h-4 w-4" />, label: 'Live Auctions', badge: pill(auctionLiveCount + auctionToAwardCount, auctionLiveCount ? 'bg-neg/15 text-neg border border-neg/30' : 'bg-gold/20 text-gold border border-gold/30', auctionLiveCount > 0) },
      'SCM Buyer/tracking': { icon: <History className="h-4 w-4" />, label: 'Track Request', badge: pill(requests.filter(r => r.status === 'PO Confirmed').length, 'bg-brand/20 text-brand border border-brand/30') },
      'SCM Buyer/discovery': { icon: <Search className="h-4 w-4" />, label: 'Find Vendors' },
      'SCM Buyer/masters': { icon: <Boxes className="h-4 w-4" />, label: 'Master Data', badge: pill(pendingDrafts.length, 'bg-brand/20 text-brand border border-brand/30', true) },
      'CEO/analytics': { icon: <TrendingUp className="h-4 w-4" />, label: 'Spend Dashboard' },
      'CEO/tracking': { icon: <History className="h-4 w-4" />, label: 'Track Request' },
      'CEO/masters': { icon: <Boxes className="h-4 w-4" />, label: 'Master Data' },
    };
    return m[`${role}/${key}`] ?? { icon: <FileText className="h-4 w-4" />, label: key };
  };
  const renderNavItem = (role: string, key: string, idx: number) => {
    const meta = navMeta(role, key);
    const active = navActive(role, key);
    return (
      <button
        key={key}
        draggable
        onDragStart={() => setDragKey(key)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => { if (dragKey) reorderNav(role, dragKey, key); setDragKey(null); }}
        onDragEnd={() => setDragKey(null)}
        onClick={() => applyNav(role, key)}
        className={`group w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-grab active:cursor-grabbing ${active ? 'bg-brand text-onbrand' : 'text-textSecondary hover:bg-brand/10 hover:text-brand'} ${dragKey === key ? 'opacity-40' : ''}`}
      >
        <span className={`text-[10px] leading-none ${active ? 'text-onbrand/70' : 'text-textFaint'} opacity-60 group-hover:opacity-100`}>⠿</span>
        {meta.icon}
        <span>{meta.label}</span>
        {idx === 0 && <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${active ? 'bg-white/20 text-onbrand' : 'bg-brand/10 text-brand'}`}>Home</span>}
        {meta.badge}
      </button>
    );
  };
  /**
   * One nav item as an icon alone, for the folded rail.
   *
   * Folding used to hide the navigation entirely, leaving a bare strip with a
   * re-open arrow — so the only way to reach another screen was to unfold
   * first. The icons stay now, and a count becomes a dot, which is enough to
   * say something is waiting without room for the number.
   */
  const renderRailItem = (role: string, key: string) => {
    const meta = navMeta(role, key);
    const active = navActive(role, key);
    return (
      <button
        key={key}
        onClick={() => applyNav(role, key)}
        title={meta.label}
        aria-label={meta.label}
        className={`relative grid h-10 w-10 place-items-center rounded-xl transition-all ${
          active ? 'bg-brand text-onbrand' : 'text-textSecondary hover:bg-brand/10 hover:text-brand'}`}
      >
        {meta.icon}
        {meta.badge && (
          <span className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
            active ? 'bg-onbrand' : 'bg-gold'}`} />
        )}
      </button>
    );
  };

  const [chatInputText, setChatInputText] = useState<string>("");
  // Files the requester picked. Held with their content because the request
  // does not exist yet when they are chosen — they are uploaded once it does.
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; data: string }[]>([]);
  const [showFileAttachedAlert, setShowFileAttachedAlert] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Voice Modal States
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'processing' | 'done'>('idle');
  const [voiceSeconds, setVoiceSeconds] = useState<number>(0);
  const [speechText, setSpeechText] = useState<string>("");
  const timerRef = useRef<any>(null);

  // Requisition Form states
  const [editProductName, setEditProductName] = useState<string>("Dell Latitude 5440 Laptops");
  const [editProductQty, setEditProductQty] = useState<number>(20);
  const [editTargetPrice, setEditTargetPrice] = useState<number>(70000);
  const [editLocation, setEditLocation] = useState<string>("Bangalore Office");
  const [editDepartment, setEditDepartment] = useState<string>("IT & Infrastructure");
  const [editExpenseCategory, setEditExpenseCategory] = useState<string>("IT Hardware & Laptops");
  // The needed-by date the extraction form opens with. Computed, not fixed: a
  // hardcoded date quietly becomes a date in the past, and Odoo refuses a
  // request needed before it was raised — which silently cost every new
  // request raised after that date had gone by.
  const [editDeliveryDate, setEditDeliveryDate] = useState<string>(() => {
    const needed = new Date();
    needed.setDate(needed.getDate() + 30);
    return needed.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  });
  const [editExpenseType, setEditExpenseType] = useState<string>("Capital Expenditure (CapEx)");
  const [extraItems, setExtraItems] = useState<LineItem[]>([]);
  // Products staged directly in the Scene 2 chat composer, before the AI extraction step.
  const [chatItems, setChatItems] = useState<LineItem[]>([]);

  // Poke / reminders (#10)
  const [pokes, setPokes] = useState<Array<{ to: string; from: string; message: string; reqId: string }>>([
    { to: 'Manager', from: 'Anjitha V', message: 'PR-2026-089 · Dell Latitude Laptops is awaiting your approval.', reqId: 'PR-2026-089' },
  ]);
  const [pokeToast, setPokeToast] = useState<string>('');
  // The "what happens next" confirmation shown to the requester on submit, and
  // the reference of the request it was raised for, so the approver's queue can
  // flag the same one as new.
  const [submittedInfo, setSubmittedInfo] = useState<{
    id: string; product: string; lines: number; total: number; owner: string;
    breach: boolean; signIn?: string;
  } | null>(null);
  const [lastSubmittedId, setLastSubmittedId] = useState<string>('');
  // The inbox a role is greeted with when it signs in and something is already
  // waiting on it, plus the request the user picked out of it — highlighted and
  // scrolled to on the screen where it can actually be acted on.
  const [inboxAlert, setInboxAlert] = useState<RequestItem[] | null>(null);
  const [focusRequestId, setFocusRequestId] = useState<string>('');
  const inboxShownRef = useRef<string>('');

  /**
   * Greet a role with what is already waiting on it.
   *
   * Runs once per sign-in per role — keyed on the token and the role, so
   * switching roles in the switcher raises the new role's inbox but simply
   * moving between screens does not. Driven off the requests themselves rather
   * than the in-session reminders, so an approver who signs in fresh (or
   * refreshes the page) is still shown the queue they came to work.
   */
  useEffect(() => {
    if (!authToken || !requestsSynced || !requests.length) return;
    const key = `${authToken.slice(0, 12)}:${userRole}`;
    if (inboxShownRef.current === key) return;
    // A supplier's portal opens on the queue itself — Approvals lists what is
    // waiting on them and carries the count. Raising a modal over it said "10
    // purchase orders are waiting on you" when most were already confirmed,
    // and sat across the tab bar so Purchase Orders and Receipts could not be
    // clicked at all.
    if (userRole === 'Vendor') { inboxShownRef.current = key; return; }
    const statuses = queueStatusesForRole(userRole);
    if (!statuses.length) { inboxShownRef.current = key; return; }
    const waiting = newestFirst(requests.filter(r => statuses.includes(r.status)));
    inboxShownRef.current = key;
    if (waiting.length) setInboxAlert(waiting);
  }, [authToken, userRole, requests, requestsSynced]);

  /** Scroll the picked request into view once its screen has rendered. */
  useEffect(() => {
    if (!focusRequestId) return;
    const timer = setTimeout(() => {
      document.getElementById(`req-${focusRequestId}`)
        ?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [focusRequestId, activeScene]);

  /** Open a request on the screen where the current role can act on it. */
  const openForAction = (r: RequestItem) => {
    setSelectedRequestId(r.id);
    setFocusRequestId(r.id);
    setInboxAlert(null);
    // Clear the reminder for this request — it has been answered by opening it.
    setPokes(prev => prev.filter(p => !(p.to === userRole && p.reqId === r.id)));
    if (userRole === 'Manager') setActiveScene(10);
    else if (userRole === 'SCM Buyer') { setActiveScene(6); setScmTab('requests'); }
    else if (userRole === 'Vendor') setActiveScene(18);
    else { setActiveScene(2); setEmployeeTab('clarify'); }
  };

  // Budget validation States
  const [budgetBreach, setBudgetBreach] = useState<boolean>(false);
  const [budgetAction, setBudgetAction] = useState<string>("default");

  // Contract selection State
  const [hasContract, setHasContract] = useState<boolean>(false);
  const [masterData, setMasterData] = useState<MasterData | null>(null);

  // Odoo owns these lists now; the hardcoded ones are only a fallback for when
  // the backend is unreachable, so the walkthrough still runs offline.
  const branchOptions = masterData?.branches.length
    ? masterData.branches.map(b => b.name) : FALLBACK_BRANCHES;
  const departmentOptions = masterData?.departments.length
    ? masterData.departments.map(d => d.name) : FALLBACK_DEPARTMENTS;
  const categoryOptions = masterData?.categories.length
    ? masterData.categories.map(c => c.name) : FALLBACK_CATEGORIES;
  const expenseTypeOptions = masterData?.categories.length
    ? Array.from(new Set(masterData.categories.map(c => c.expenseType))) : FALLBACK_EXPENSE_TYPES;

  // Master Data Console rows (#16). Odoo's feed when it answers, the same
  // fallback lists the dropdowns use otherwise — so the console and the request
  // form can never show different records.
  /**
   * Records created in this console.
   *
   * Held here rather than written to Odoo: there is no portal endpoint that
   * creates master data, and the demo needs to show a master being added
   * without a backend behind it. The panel says so, the same way the workflow
   * editor does — a console that silently discards what you typed is worse
   * than one that admits where it kept it.
   */
  const [addedMasters, setAddedMasters] = useState<{
    products: MasterProduct[]; categories: MasterCategory[];
    branches: { name: string; code: string; city: string }[];
    vendors: MasterVendor[]; companies: Company[];
  }>({ products: [], categories: [], branches: [], vendors: [], companies: [] });
  // Which master is being added to, and what has been typed so far.
  const [masterForm, setMasterForm] = useState<{ kind: string; values: Record<string, string> } | null>(null);
  const branchRows = [...addedMasters.branches, ...(masterData?.branches.length
    ? masterData.branches.map(b => ({ name: b.name, code: b.code || '—', city: b.city || '—' }))
    : FALLBACK_BRANCHES.map((n, i) => ({
        name: n, code: `BR-${String(i + 1).padStart(3, '0')}`,
        city: n.replace(/\s+(Head\s+)?Office$/i, ''),
      })))];
  const departmentRows = masterData?.departments.length
    ? masterData.departments.map(d => ({ name: d.name, code: d.code || '—', approver: d.approver || 'Not set' }))
    : FALLBACK_DEPARTMENTS.map((n, i) => ({ name: n, code: `DEP-${String(i + 1).padStart(3, '0')}`, approver: 'Reporting Manager' }));
  // The approval matrix as Odoo holds it. Empty when the backend predates the
  // workflow master or is unreachable — the tab then describes the standard
  // process instead of showing nothing.
  const configuredWorkflows: ConfiguredWorkflow[] = masterData?.workflows ?? [];
  // Workflows created or edited in this console. The demo shows the approval
  // matrix being configured; there is no portal endpoint that writes to Odoo's
  // workflow master, so these live in the browser and the screen says so.
  const [workflowOverrides, setWorkflowOverrides] = useState<ConfiguredWorkflow[]>([]);
  // null when the editor is closed; otherwise the workflow being written.
  const [workflowForm, setWorkflowForm] = useState<ConfiguredWorkflow | null>(null);
  // An edit replaces the row it came from; a new one is listed first.
  const workflowRows: ConfiguredWorkflow[] = [
    ...workflowOverrides.filter(o => !configuredWorkflows.some(w => w.id === o.id)),
    ...configuredWorkflows.map(w => workflowOverrides.find(o => o.id === w.id) ?? w),
  ];
  const blankWorkflow = (): ConfiguredWorkflow => ({
    id: -Date.now(), name: '', document: 'Purchase Request', workflowType: 'procurement',
    branch: 'Any', department: 'Any', category: 'Any',
    expenseType: 'Operating Expenditure (OpEx)', amountFrom: 0, amountTo: 2000000,
    approvers: [{ order: 1, designation: 'Reporting Manager', branch: 'Any', department: 'Any' }],
  });
  /** Store the workflow being edited, renumbering its levels from the order shown. */
  const saveWorkflow = () => {
    if (!workflowForm) return;
    const clean: ConfiguredWorkflow = {
      ...workflowForm,
      name: workflowForm.name.trim() || 'Untitled workflow',
      approvers: workflowForm.approvers.map((a, i) => ({ ...a, order: i + 1 })),
    };
    setWorkflowOverrides(prev => [...prev.filter(o => o.id !== clean.id), clean]);
    setWorkflowForm(null);
  };
  const categoryRows: MasterCategory[] = masterData?.categories.length
    ? masterData.categories.map(c => {
        const detail = MASTER_CATEGORIES.find(m => m.name === c.name || c.name.includes(m.name));
        return {
          name: c.name, expenseType: c.expenseType,
          glCode: detail?.glCode ?? '—', limit: detail?.limit ?? 0, owner: detail?.owner ?? '—',
        };
      })
    : MASTER_CATEGORIES;
  // SCM Buyer Portal Local States
  const [scmTab, setScmTab] = useState<'requests' | 'bidding' | 'discovery'>('requests');
  const [discoveredVendors, setDiscoveredVendors] = useState<Array<{ name: string; category: string; rating: number; score: number; registered: boolean; id?: string }>>([]);
  const [searchVendorQuery, setSearchVendorQuery] = useState<string>("");
  const [searchingVendors, setSearchingVendors] = useState<boolean>(false);
  const [showDraftOnboardSuccess, setShowDraftOnboardSuccess] = useState<boolean>(false);
  const [lastOnboardedVendor, setLastOnboardedVendor] = useState<string>("");

  // Master Data Console (#16) — which master is open, its search box, and the
  // AI draft-vendor queue. A draft only becomes a vendor when someone approves
  // it here, so the decision is held in state rather than written on discovery.
  const [mastersTab, setMastersTab] = useState<'products' | 'categories' | 'workflow' | 'company' | 'branches' | 'vendors'>('products');
  const [masterSearch, setMasterSearch] = useState<string>("");
  // Tiles or rows, for the masters that render as cards.
  const [masterView, setMasterView] = useState<'grid' | 'list'>('grid');
  const [vendorView, setVendorView] = useState<'master' | 'ai'>('master');
  const [openDraft, setOpenDraft] = useState<string | null>(AI_DRAFT_VENDORS[0]?.id ?? null);
  const [draftDecisions, setDraftDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [promotedVendors, setPromotedVendors] = useState<MasterVendor[]>([]);
  const [draftToast, setDraftToast] = useState<string>("");
  // Two-step guard on the destructive reset, so it can never be a stray click.
  const [resetArmed, setResetArmed] = useState<boolean>(false);
  const vendorRows: MasterVendor[] = [...addedMasters.vendors, ...promotedVendors, ...MASTER_VENDORS];
  const productRows: MasterProduct[] = [...addedMasters.products, ...MASTER_PRODUCTS];
  const companyRows: Company[] = [...addedMasters.companies, ...COMPANIES];
  const allCategoryRows: MasterCategory[] = [...addedMasters.categories, ...categoryRows];

  /**
   * What each master asks for when adding a record.
   *
   * One spec instead of six forms: the fields differ, the panel does not, so a
   * new master needs a row here rather than another dialog.
   */
  const MASTER_FORMS: Record<string, { label: string; fields: { k: string; l: string; type?: 'number'; opts?: string[] }[] }> = {
    products: { label: 'product', fields: [
      { k: 'name', l: 'Product name' },
      { k: 'code', l: 'Code' },
      { k: 'category', l: 'Category', opts: allCategoryRows.map(c => c.name) },
      { k: 'uom', l: 'Unit', opts: ['Unit', 'Set', 'Licence', 'Box', 'Service'] },
      { k: 'contract', l: 'Contract rate (₹)', type: 'number' },
      { k: 'vendor', l: 'Vendor', opts: vendorRows.map(v => v.name) },
    ]},
    categories: { label: 'expense category', fields: [
      { k: 'name', l: 'Category name' },
      { k: 'expenseType', l: 'Expense type', opts: ['CapEx', 'OpEx'] },
      { k: 'glCode', l: 'GL code' },
      { k: 'limit', l: 'Approval limit (₹)', type: 'number' },
      { k: 'owner', l: 'Owning department', opts: departmentRows.map(d => d.name) },
    ]},
    branches: { label: 'branch', fields: [
      { k: 'name', l: 'Branch name' },
      { k: 'code', l: 'Code' },
      { k: 'city', l: 'City' },
    ]},
    vendors: { label: 'vendor', fields: [
      { k: 'name', l: 'Vendor name' },
      { k: 'category', l: 'Category', opts: allCategoryRows.map(c => c.name) },
      { k: 'code', l: 'Vendor code' },
      { k: 'terms', l: 'Payment terms', opts: ['Net 15', 'Net 30', 'Net 45', 'Advance 20% / Net 30'] },
      { k: 'rating', l: 'Rating (0–5)', type: 'number' },
      { k: 'since', l: 'Vendor since' },
    ]},
    company: { label: 'company', fields: [
      { k: 'name', l: 'Registered name' },
      { k: 'short', l: 'Short name' },
      { k: 'gstin', l: 'GSTIN' },
      { k: 'cin', l: 'CIN' },
      { k: 'state', l: 'Registered state' },
    ]},
  };

  /** Store what was typed, as the row shape that master renders. */
  const saveMasterRecord = () => {
    if (!masterForm) return;
    const v = masterForm.values;
    const name = (v.name || '').trim();
    if (!name) return;
    const num = (x?: string) => Number(x) || 0;
    setAddedMasters(prev => {
      switch (masterForm.kind) {
        case 'products': return { ...prev, products: [{
          code: (v.code || `PRD-NEW-${prev.products.length + 1}`).trim(), name,
          category: v.category || allCategoryRows[0]?.name || '—', uom: v.uom || 'Unit',
          contract: num(v.contract), vendor: v.vendor || '—',
          onContract: num(v.contract) > 0,
        }, ...prev.products] };
        case 'categories': return { ...prev, categories: [{
          name, expenseType: v.expenseType || 'OpEx', glCode: v.glCode || '—',
          limit: num(v.limit), owner: v.owner || '—',
        }, ...prev.categories] };
        case 'branches': return { ...prev, branches: [{
          name, code: (v.code || `BR-NEW-${prev.branches.length + 1}`).trim(),
          city: v.city || name.replace(/\s+(Head\s+)?Office$/i, ''),
        }, ...prev.branches] };
        case 'vendors': return { ...prev, vendors: [{
          name, category: v.category || allCategoryRows[0]?.name || '—',
          rating: Math.min(5, num(v.rating)), code: (v.code || `VEN-NEW-${prev.vendors.length + 1}`).trim(),
          terms: v.terms || 'Net 30', since: v.since || String(new Date().getFullYear()),
          status: 'Active', origin: 'Onboarded',
        }, ...prev.vendors] };
        case 'company': return { ...prev, companies: [{
          name, short: v.short || name, gstin: v.gstin || '—', cin: v.cin || '—',
          state: v.state || '—', branches: [],
        }, ...prev.companies] };
        default: return prev;
      }
    });
    setMasterForm(null);
  };


  const pendingDrafts = AI_DRAFT_VENDORS.filter(d => !draftDecisions[d.id]);

  /** Promote an AI-discovered draft into the approved vendor master. */
  const approveDraftVendor = (d: DraftVendor) => {
    setDraftDecisions(prev => ({ ...prev, [d.id]: 'approved' }));
    setPromotedVendors(prev => prev.some(v => v.name === d.name) ? prev : [{
      name: d.name,
      category: d.category,
      rating: Math.round((d.trust / 20) * 10) / 10,
      code: `VEN-${d.id.replace(/\D/g, '').slice(-4)}`,
      terms: d.fields.find(f => /payment terms/i.test(f.label))?.value ?? 'Net 30',
      since: String(new Date().getFullYear()),
      status: 'Active',
      origin: 'AI Discovered',
    }, ...prev]);
    setDraftToast(`${d.name} approved — now in the vendor master and quotable on any request.`);
    setTimeout(() => setDraftToast(""), 5000);
  };
  /** Turn a draft down. It stays in the discovery log, it just never becomes a vendor. */
  const rejectDraftVendor = (d: DraftVendor) => {
    setDraftDecisions(prev => ({ ...prev, [d.id]: 'rejected' }));
    setDraftToast(`${d.name} rejected — kept in the discovery log, not created.`);
    setTimeout(() => setDraftToast(""), 5000);
  };

  // Which of the vendor's three views is open.
  const [vendorTab, setVendorTab] = useState<'orders' | 'receipts' | 'approvals' | 'auctions'>('orders');
  // The order a supplier has opened. A row is a summary; this is the order and
  // the delivery against it in full.
  const [vendorDetailId, setVendorDetailId] = useState<string | null>(null);

  // ---- Live reverse auctions (src/auction.tsx) ----------------------------
  // The request the buyer asked to auction from the sourcing queue, and the
  // auction to open when they land on the desk.
  const [auctionLaunchFor, setAuctionLaunchFor] = useState<string | null>(null);
  const [auctionOpen, setAuctionOpen] = useState<string | null>(null);
  // Just enough about every auction for the sidebar badges and the sourcing
  // queue: which request each belongs to and where it stands. The auction
  // screens poll their own detail; this only keeps the counts honest.
  const [auctionIndex, setAuctionIndex] = useState<{ id: string; requestId?: string; state: string; meState?: string }[]>([]);
  const auctionApi = (path: string, init?: RequestInit) => apiFetch(path, init);
  /** Take the request an auction action changed, without echoing it back as a save. */
  const swapInRequest = (updated: AuctionableRequest) => {
    setRequests(prev => {
      const next = prev.map(r => r.id === updated.id ? (updated as unknown as RequestItem) : r);
      lastOdooSyncRef.current = JSON.stringify(next);
      return next;
    });
  };
  useEffect(() => {
    if (!authToken || offlineDemo || !['SCM Buyer', 'Vendor'].includes(userRole)) { setAuctionIndex([]); return; }
    let stopped = false;
    const tick = async () => {
      try {
        const res = await apiFetch('/api/smartspend/auctions', { method: 'GET' });
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (Array.isArray(data) && !stopped) {
          setAuctionIndex(data.map((a: any) => ({ id: a.id, requestId: a.requestId, state: a.state, meState: a.me?.state })));
        }
      } catch { /* the badges keep their last value */ }
    };
    void tick();
    const timer = setInterval(tick, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [authToken, offlineDemo, userRole, odooApiUrl, activeScene]);
  const auctionLiveCount = auctionIndex.filter(a => a.state === 'live').length;
  const auctionToAwardCount = auctionIndex.filter(a => a.state === 'closed').length;
  const vendorAuctionCount = auctionIndex.filter(a =>
    (a.state === 'scheduled' && a.meState === 'invited') || (a.state === 'live' && a.meState === 'live')).length;
  const auctionForRequest = (id: string) =>
    auctionIndex.find(a => a.requestId === id && a.state !== 'cancelled');

  // Vendor Portal Local States
  const [vendorBidPrice, setVendorBidPrice] = useState<string>("118000");
  const [vendorLeadTime, setVendorLeadTime] = useState<string>("5 Days");
  const [vendorBidSubmitted, setVendorBidSubmitted] = useState<boolean>(false);

  // PO Approval & Vendor Acknowledgment States
  // Who may act on a purchase order from the tracking screen. These controls
  // used to render for whoever happened to be looking, so a requester could
  // release their own PO and then sign for the vendor as well — the two
  // approvals the release is supposed to be separated by.
  //   • Releasing the PO is the purchase head's call: the approver, never the
  //     requester and never the buyer who raised it.
  //   • The vendor acknowledgment is an explicit simulation of the supplier's
  //     reply, so it belongs to the staff who own the order.
  const isPurchaseHead = userRole === 'Manager';
  // Raising the order is the buyer's job and only the buyer's. Odoo would let a
  // manager through (the manager group implies the buyer group), but allowing
  // it here let the manager approve, order and close a request single-handed —
  // the buyer never appeared in the flow at all.
  const canRaisePurchaseOrder = userRole === 'SCM Buyer';
  // Recording the supplier's reply belongs to the two parties to it.
  const canRecordVendorReply = userRole === 'SCM Buyer' || userRole === 'Vendor';
  // Receiving the goods, matching the bill and paying it are the purchase
  // manager's to run. These three had no role check at all, so whoever happened
  // to be on screen when the vendor acknowledged carried the request the rest of
  // the way to Paid — the requester who raised it included.
  const canRunFulfilment = userRole === 'Manager';

  // Both steps are read off the request Odoo answered with, not held here. As
  // component state they were forgotten on every reload and on every sign-out,
  // and one pair of booleans stood for the whole list — approving the release
  // on one request showed it as released on all of them.
  const poApprovedByHead = !!currentRequest?.poReleased;
  const poAcknowledgedByVendor = !!currentRequest?.poAcknowledged;
  // Raising the Odoo purchase order from the tracking screen.
  const [poBusy, setPoBusy] = useState<boolean>(false);
  const [poError, setPoError] = useState<string>("");
  // The two release steps, which go the same way: Odoo decides, and the answer
  // it echoes back replaces the request in the list.
  const [poStepBusy, setPoStepBusy] = useState<string>("");

  // Manager Clarification Prompt State
  const [managerQueryText, setManagerQueryText] = useState<string>("");
  const [showManagerQueryBox, setShowManagerQueryBox] = useState<boolean>(false);
  const [managerApprovalNote, setManagerApprovalNote] = useState<string>("");
  const [showManagerApproveBox, setShowManagerApproveBox] = useState<boolean>(false);

  // Employee Clarification Reply State
  const [employeeReplyText, setEmployeeReplyText] = useState<string>("");

  // AI Negotiation State
  const [negotiationStep, setNegotiationStep] = useState<number>(0);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [currentOfferPrice, setCurrentOfferPrice] = useState<number>(68000);
  const [negotiationComplete, setNegotiationComplete] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Quick navigation helpers
  // nextScene / prevScene removed along with the DEMO STEP header controls —
  // every screen is reached from the sidebar or an in-screen button now.

  // Simulation timer for voice recording
  useEffect(() => {
    if (voiceState === 'listening') {
      setVoiceSeconds(0);
      timerRef.current = setInterval(() => {
        setVoiceSeconds(prev => {
          if (prev >= 4) {
            clearInterval(timerRef.current!);
            setVoiceState('processing');
            simulateProcessing();
            return 4;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [voiceState]);

  const simulateProcessing = () => {
    setTimeout(() => {
      setSpeechText("I need twenty Dell Latitude laptops for the Bangalore office.");
      setVoiceState('done');
    }, 1500);
  };
  const parseSpeechText = (text: string, staged: LineItem[] = []) => {
    const lower = text.toLowerCase();
    let name = "Dell Latitude 5440 Laptops";
    let qty = 20;
    let loc = "Bangalore Office";
    let cat = "IT Hardware & Laptops";

    if (lower.includes("chair") || lower.includes("furniture") || lower.includes("chairs")) {
      name = "Ergonomic Office Chairs";
      qty = 10;
      loc = "Kochi Head Office";
      cat = "Office Furniture";
    } else if (lower.includes("server") || lower.includes("rack") || lower.includes("racks")) {
      name = "19-Inch Data Server Racks";
      qty = 2;
      loc = "Mumbai Office";
      cat = "Datacenter Equipment";
    }

    // Pull an explicit quantity and branch out of the sentence when the user gave one.
    const qtyMatch = lower.match(/(\d+)\s*(units?|nos?|pcs?|pieces?)?\s/);
    if (qtyMatch) qty = Number(qtyMatch[1]);
    const branch = ['Bangalore', 'Kochi', 'Mumbai', 'Delhi', 'Chennai', 'Hyderabad'].find(b => lower.includes(b.toLowerCase()));
    if (branch) loc = branch === 'Kochi' ? 'Kochi Head Office' : `${branch} Office`;

    // Products staged in the chat composer flow straight into the extraction form.
    let rest = staged.filter(it => it.productName.trim());
    if (!text.trim() && rest.length) {
      // Staged products only, no sentence — the first staged product becomes the primary line.
      name = rest[0].productName;
      qty = rest[0].productQty;
      cat = subCatalogFor(name)?.category ?? cat;
      rest = rest.slice(1);
    } else {
      rest = rest.filter(it => it.productName !== name);
    }

    setEditProductName(name);
    setEditProductQty(qty);
    // Indicative catalog rate so the requisition carries a value from the very first step.
    setEditTargetPrice(getContractPrice(name));
    setEditLocation(loc);
    setEditExpenseCategory(cat);
    setExtraItems(rest.map(it => ({ ...it, targetPrice: it.targetPrice || getContractPrice(it.productName) })));
  };

  const handleSsoLogin = (role: string) => {
    setUserRole(role);
    if (role === "Vendor") {
      setActiveScene(18); // the supplier's own portal
    } else {
      // Land on the role's first (drag-ordered) nav item.
      applyNav(role, (navOrder[role] || DEFAULT_NAV_ORDER[role])?.[0]);
    }
  };

  // An offline session must not outlive the outage that caused it.
  //
  // Signing in with no backend reachable stores a marker token so a reload does
  // not throw the visitor out. But the marker also switches every call off, so
  // once a browser had signed in offline it never spoke to Odoo again — it kept
  // showing seeded records with the backend up and answering, and there was no
  // way back short of signing out.
  //
  // So when a session is running offline, ask whether the backend has come
  // back. Any answer at all means it has (401 is the expected one, since this
  // probe carries no token), and the offline session is dropped so the next
  // sign-in is a real one. Still unreachable — a hosted build, or Odoo actually
  // down — and it stands, which is what keeps the demo working.
  useEffect(() => {
    if (!offlineDemo) return;
    let cancelled = false;
    void (async () => {
      try {
        await fetch(`${odooApiUrl}/api/smartspend/me`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (!cancelled) clearSession();
      } catch {
        /* Still not there. The offline session is doing its job. */
      }
    })();
    return () => { cancelled = true; };
  }, [offlineDemo, odooApiUrl]);

  // A reload landed on the sign-in screen even with a session in hand:
  // activeScene starts at 1, and the gate renders scene 1 whether or not there
  // is a token. Nothing had actually signed the visitor out. Put them back on
  // their account's portal — the same landing sign-in itself picks — so a
  // refresh keeps them where they were.
  const sessionRestored = useRef(false);
  // Before paint, not after: a useEffect here still let the sign-in screen
  // render for a frame, which is the flicker that read as being signed out.
  useLayoutEffect(() => {
    if (sessionRestored.current || !authToken || !currentUser) return;
    sessionRestored.current = true;
    const role = currentUser.defaultRole || 'Employee';
    // An explicit ?scene= is a deep link and outranks the default landing —
    // but only the landing. The role comes from the account either way, or a
    // deep link would put a manager on a requester's navigation.
    if (params?.get('scene')) { setUserRole(role); return; }
    handleSsoLogin(role);
  }, [authToken, currentUser]);

  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInputText.trim() && chatItems.length === 0) return;

    setIsParsing(true);
    let parsedSuccessfully = false;

    // Whatever is staged in the composer belongs to this requisition too, so it
    // travels with the sentence — otherwise Odoo answers with the sentence's
    // lines alone and the staged products never reach the extraction form.
    const stagedItems = chatItems
      .filter(it => it.productName.trim())
      .map(it => ({
        productName: it.productName.trim(),
        productQty: it.productQty || 1,
        targetPrice: it.targetPrice || 0,
      }));

    if (chatInputText.trim() || stagedItems.length) {
      try {
        const res = await apiFetch(`/api/smartspend/parse`, {
          method: 'POST',
          body: JSON.stringify({ text: chatInputText, items: stagedItems }),
        });
        if (res.ok) {
          const reqData = await res.json();
          if (reqData && reqData.id) {
            setEditProductName(reqData.productName || "");
            setEditProductQty(reqData.productQty || 1);
            setEditTargetPrice(reqData.targetPrice || 0);
            setEditLocation(reqData.location || "Bangalore Office");
            setEditExpenseCategory(reqData.expenseCategory || "IT Hardware & Laptops");
            setEditDepartment(reqData.department || "IT & Infrastructure");
            setExtraItems(reqData.lineItems?.slice(1).map((ln: any) => ({
              productName: ln.productName,
              productQty: ln.productQty,
              targetPrice: ln.targetPrice,
            })) || []);
            setCurrentOdooRequestName(reqData.id);
            parsedSuccessfully = true;
          }
        }
      } catch (e) {
        console.warn("Parse failed, falling back to local simulation", e);
      }
    }

    if (!parsedSuccessfully) {
      parseSpeechText(chatInputText, chatItems);
      setCurrentOdooRequestName("New");
    }

    setIsParsing(false);
    setChatInputText("");
    setChatItems([]);
    setActiveScene(4); // Go to extraction form
  };

  /** Open the file picker. The attachment used to be a name with no file. */
  const handleAttachmentAdd = () => fileInputRef.current?.click();

  /** Read what was picked, and keep it until the request exists to attach it to. */
  const handleFilesPicked = async (files: FileList | null) => {
    if (!files?.length) return;
    const read = await Promise.all(Array.from(files).map(file => new Promise<{ name: string; data: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, data: String(reader.result || '') });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setAttachedFiles(prev => [...prev, ...read.filter(f => !prev.some(p => p.name === f.name))]);
    setShowFileAttachedAlert(true);
    setTimeout(() => setShowFileAttachedAlert(false), 4000);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Send the picked files to the backend, now the request exists.
   *
   * Each is stored as an attachment on the request, which is what the backend
   * form and its chatter read — so a document the requester uploaded is one an
   * approver can actually open.
   */
  const uploadAttachments = async (reqId: string, url: string = odooApiUrl) => {
    if (!authToken || offlineDemo || !attachedFiles.length) return;
    for (const file of attachedFiles) {
      try {
        const res = await apiFetch(`/api/smartspend/attachment`, {
          method: 'POST',
          body: JSON.stringify({ id: reqId, filename: file.name, data: file.data }),
        }, url);
        if (!res.ok) {
          const message = await refusalMessage(res);
          noteSyncError({
            key: `file:${reqId}:${file.name}`, id: reqId,
            what: `attachment ${file.name} was not stored`,
            message, retry: () => uploadAttachments(reqId, url),
          });
        }
      } catch (e) {
        noteSyncError({
          key: `file:${reqId}:${file.name}`, id: reqId,
          what: `attachment ${file.name} was not stored`,
          message: unreachableMessage(e, url), retry: () => uploadAttachments(reqId, url),
        });
      }
    }
  };

  // Convert Extraction Form to Live Request
  // Poke: nudge whoever owns the next action for a request.
  const pokeTargetRole = (status: string) => {
    if (status === 'Pending Approval' || status === 'Needs Clarification') return 'Manager';
    if (status === 'Sourcing' || status === 'Approved') return 'SCM Buyer';
    if (status === 'PO Confirmed') return 'Vendor';
    return 'Manager';
  };
  const handlePoke = (req: RequestItem) => {
    const to = pokeTargetRole(req.status);
    setPokes(prev => [...prev, { to, from: userRole, message: `${req.id} · ${req.productName} needs your attention.`, reqId: req.id }]);
    setPokeToast(`🔔 Reminder poked to ${to}`);
    setTimeout(() => setPokeToast(''), 2800);
  };

  const createRequisitionFromForm = async () => {
    const isNew = currentOdooRequestName === "New";
    const reqId = isNew ? `PR-2026-0${90 + requests.length}` : currentOdooRequestName;
    const allItems: LineItem[] = [{ productName: editProductName, productQty: editProductQty, targetPrice: editTargetPrice }, ...extraItems.filter(it => it.productName.trim())];
    const newReq: RequestItem = {
      id: reqId,
      productName: editProductName,
      productQty: linesQty(allItems),
      targetPrice: editTargetPrice,
      totalCost: linesTotal(allItems),
      location: editLocation,
      department: editDepartment,
      expenseCategory: editExpenseCategory,
      lineItems: allItems,
      // Always Pending Approval. `budgetBreach` is shared state carried from
      // whichever request was last open (and from the demo toggle on the budget
      // screen), so reading it here stamped a brand-new request with the last
      // one's budget verdict — which is how a freshly raised PR was born as
      // "Needs Clarification" and vanished from the approver's queue. A new
      // request has not been budget-checked yet; that happens at the budget
      // verification step.
      status: "Pending Approval",
      urgency: "High",
      deliveryDate: editDeliveryDate || undefined,
      createdDate: new Date().toLocaleDateString([], { month: 'short', day: '2-digit' }) + ", " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      // Sortable companion to createdDate, so this lands at the top of the
      // approver's queue straight away rather than waiting for Odoo's copy.
      submittedAt: new Date().toISOString(),
      buyer: "SCM-IT-14",
      vendor: "Pending Sourcing",
      savings: 0,
      history: [
        { title: "Request Submitted", date: "Now", desc: "Submitted via extraction panel" }
      ],
      clarificationComments: [],
      vendorBids: [],
      selectedSourcingMethod: "Multi RFQ",
      attachments: attachedFiles.map(f => f.name)
    };

    setRequests(prev => [newReq, ...prev.filter(r => r.id !== reqId)]);
    setSelectedRequestId(reqId);
    setAttachedFiles([]);
    setExtraItems([]);
    // Start the new request's budget check clean rather than inheriting the
    // previous request's verdict.
    setBudgetBreach(false);

    // Tell whoever owns the next step that it is waiting on them. This used to
    // happen only when somebody pressed "Remind" on a request card, so a
    // submitted request sat in the approver's queue with nothing announcing it.
    const nextOwner = pokeTargetRole(newReq.status);
    setPokes(prev => [...prev, {
      to: nextOwner,
      from: currentUser?.name || userRole,
      message: `${reqId} · ${newReq.productName} · ₹${newReq.totalCost.toLocaleString('en-IN')} is waiting for your approval.`,
      reqId,
    }]);
    // Mark it as the newest so the approver's queue can point straight at it.
    setLastSubmittedId(reqId);
    // And tell the requester what just happened and who has it now — the step
    // that was missing, which left them on the next screen with no idea what
    // to do or wait for.
    // Odoo answers with the matched chain, so the login to approve with is only
    // known once the save lands. Filled in by the sync below when it does.
    setSubmittedInfo({
      id: reqId,
      product: editProductName,
      lines: allItems.length,
      total: linesTotal(allItems),
      owner: nextOwner,
      breach: false,
    });
    void (async () => {
      const saved = (await submitRequestToOdoo(newReq)) as RequestItem | null;
      // The files were picked before the request existed; it does now.
      if (saved?.id) { await uploadAttachments(saved.id); setAttachedFiles([]); }
      const waiting = saved?.approvalChain?.find((step: ApprovalStep) => step.state === 'pending');
      if (!waiting) return;
      setSubmittedInfo(prev => prev && prev.id === reqId ? {
        ...prev,
        owner: waiting.designation,
        signIn: waiting.holders?.map((h: { login: string }) => h.login).join(' or ') || undefined,
      } : prev);
    })();

    // Go to next step in demo
    setActiveScene(5);
  };

  /**
   * Send a manager's decision to Odoo, which is what actually moves the
   * request: it checks the role, writes the state, records the comment on the
   * request thread and returns the saved record.
   * Returns null when the backend is unreachable, so the caller can simulate.
   */
  const decideInOdoo = async (id: string, decision: 'approve' | 'reject' | 'clarify', comment?: string) => {
    if (!authToken) return null;
    // Returning null is the signal the caller already understands: apply the
    // decision locally. No sync-error row — nothing is out of step with Odoo
    // when there is no Odoo.
    if (offlineDemo) return null;
    const what = decision === 'approve' ? 'approval was not recorded'
      : decision === 'reject' ? 'rejection was not recorded'
        : 'clarification request was not recorded';
    const fail = (message: string) => noteSyncError({
      key: `decide:${id}`, id, what,
      message: message + SIMULATED, retry: () => decideInOdoo(id, decision, comment),
    });
    try {
      const res = await apiFetch(`/api/smartspend/decide`, {
        method: 'POST',
        body: JSON.stringify({ id, decision, comment: comment || '' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => {
          const newState = prev.map(r => (r.id === id ? updated : r));
          lastOdooSyncRef.current = JSON.stringify(newState);
          return newState;
        });
        clearSyncError(`decide:${id}`);
        return updated as RequestItem;
      }
      const message = await refusalMessage(res);
      console.warn("The server refused the decision:", message);
      fail(message);
    } catch (e) {
      console.warn("Failed to send the decision:", e);
      fail(unreachableMessage(e, odooApiUrl));
    }
    return null;
  };

  // Manager Approval Action
  const handleManagerApprove = async (id: string, note?: string) => {
    const approvalNote = (note ?? "").trim();
    const decided = await decideInOdoo(id, 'approve', approvalNote || undefined);
    if (!decided) {
      setRequests(prev => prev.map(r => {
        if (r.id === id) {
          return {
            ...r,
            status: "Approved",
            // The note belongs on the same thread the requester already reads.
            clarificationComments: approvalNote
              ? [...(r.clarificationComments || []), { role: 'manager' as const, text: approvalNote, date: "Now" }]
              : r.clarificationComments,
            history: [...r.history, {
              title: "Approved by Manager", date: "Now",
              desc: approvalNote ? `Approved by Operational Manager — ${approvalNote}` : "Approved by Operational Manager",
            }]
          };
        }
        return r;
      }));
    }
    setManagerApprovalNote("");
    setShowManagerApproveBox(false);

    // One signature is not necessarily approval. A configured workflow can
    // demand several, and Odoo answers with the request still Pending Approval
    // until the last of them signs — so read the answer rather than assuming
    // this click released it, or the buyer is called in two levels early.
    const label = decided?.productName || requests.find(r => r.id === id)?.productName || '';
    const stillWaiting = decided ? decided.status === 'Pending Approval' : false;
    const nextStep = decided?.approvalChain?.find(step => step.state === 'pending');

    if (stillWaiting && nextStep) {
      // Passed to the next level of the same chain, not out of approval.
      setPokes(prev => [...prev, {
        to: 'Manager',
        from: currentUser?.name || userRole,
        message: `${id}${label ? ` · ${label}` : ''} needs the ${nextStep.designation} to sign (level ${nextStep.order} of ${decided?.approvalTotal ?? '?'}).`,
        reqId: id,
      }]);
      setPokeToast(`Level signed · now with the ${nextStep.designation}`);
      setTimeout(() => setPokeToast(''), 3200);
    } else {
      // Fully approved: it is the SCM buyer's to source now.
      setPokes(prev => [...prev, {
        to: 'SCM Buyer',
        from: currentUser?.name || userRole,
        message: `${id}${label ? ` · ${label}` : ''} is approved and ready to source.`,
        reqId: id,
      }]);
    }
    setLastSubmittedId(id);
    setActiveScene(11); // Route to order tracking
  };

  const handleManagerReject = async (id: string) => {
    const decided = await decideInOdoo(id, 'reject');
    if (!decided) {
      setRequests(prev => prev.map(r => r.id === id ? {
        ...r,
        status: "Rejected",
        history: [...r.history, { title: "Rejected", date: "Now", desc: "Rejected by Manager" }],
      } : r));
    }
  };

  // Manager Request Information Loop
  const handleRequestInfoSubmit = async (id: string) => {
    if (!managerQueryText.trim()) return;

    const decided = await decideInOdoo(id, 'clarify', managerQueryText);
    if (decided) {
      setManagerQueryText("");
      setShowManagerQueryBox(false);
      alert("Clarification request sent back to the employee.");
      return;
    }

    setRequests(prev => prev.map(r => {
      if (r.id === id) {
        return {
          ...r,
          status: "Needs Clarification",
          clarificationComments: [
            ...r.clarificationComments,
            { role: 'manager', text: managerQueryText, date: "Now" }
          ],
          history: [...r.history, { title: "Info Requested", date: "Now", desc: `Query: "${managerQueryText}"` }]
        };
      }
      return r;
    }));

    setManagerQueryText("");
    setShowManagerQueryBox(false);
    alert("Clarification request sent back to the employee.");
  };

  // Employee responds to manager request
  const handleEmployeeReplySubmit = (id: string) => {
    if (!employeeReplyText.trim()) return;

    setRequests(prev => prev.map(r => {
      if (r.id === id) {
        return {
          ...r,
          status: "Pending Approval",
          clarificationComments: [
            ...r.clarificationComments,
            { role: 'employee', text: employeeReplyText, date: "Now" }
          ],
          history: [...r.history, { title: "Clarified by Employee", date: "Now", desc: `Response: "${employeeReplyText}"` }]
        };
      }
      return r;
    }));

    setEmployeeReplyText("");
    alert("Clarification submitted. Re-routed to manager approval queue.");
    setEmployeeTab('list');
  };

  // AI Vendor Discovery simulation
  const handleSearchVendors = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchVendorQuery.trim()) return;

    setSearchingVendors(true);
    setTimeout(() => {
      setSearchingVendors(false);
      setDiscoveredVendors([
        { name: "Global Hardware Integrators", category: "Servers & IT Network", rating: 92, score: 95, registered: false },
        { name: "Apex Sourcing Solutions", category: "Office Equipment & Furniture", rating: 85, score: 88, registered: false },
        { name: "Zenith Business Networks", category: "Datacenter Rack Cabinets", rating: 88, score: 91, registered: false }
      ]);
    }, 1000);
  };

  // Auto-onboard Draft Partner in Odoo
  const handleAutoOnboard = (vendorName: string) => {
    setLastOnboardedVendor(vendorName);
    setShowDraftOnboardSuccess(true);
    
    // Add this vendor to the current request's bids
    setRequests(prev => prev.map(r => {
      if (r.id === selectedRequestId) {
        return {
          ...r,
          vendorBids: [
            ...r.vendorBids,
            { vendorName, price: r.targetPrice - 2000, leadTime: "6 Days", warranty: "2 Years", status: "Qualified" }
          ]
        };
      }
      return r;
    }));

    setTimeout(() => setShowDraftOnboardSuccess(false), 5000);
  };

  // Vendor Portal bids submit
  const handleVendorBidSubmit = () => {
    if (!vendorBidPrice.trim()) return;
    
    const bidAmount = Number(vendorBidPrice);
    setRequests(prev => prev.map(r => {
      if (r.id === selectedRequestId) {
        return {
          ...r,
          vendorBids: [
            ...r.vendorBids,
            { vendorName: "Primus Technologies (Your Portal)", price: bidAmount, leadTime: vendorLeadTime, warranty: "3 Years On-Site", status: "Submitted" }
          ]
        };
      }
      return r;
    }));

    setVendorBidSubmitted(true);
    setTimeout(() => setVendorBidSubmitted(false), 3000);
  };

  // AI Negotiation Simulation Step-by-Step
  const triggerNextNegotiationStep = () => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const baseline = getNegotiationBaselinePrice(currentRequest.productName);
    const negotiated = getNegotiatedTargetPrice(currentRequest.productName);
    const midPoint = Math.round((baseline + negotiated) / 2);
    
    if (negotiationStep === 0) {
      setChatLog([
        { sender: 'ai', text: `Hello Primus Sales Bot. We are looking to place an immediate order for ${currentRequest.productQty} units of ${currentRequest.productName}. Your bid is listed at ₹${baseline.toLocaleString()}. Under our standard volume discount agreement, we request a final target rate of ₹${negotiated.toLocaleString()} with Net-30 payment terms.`, timestamp }
      ]);
      setNegotiationStep(1);
    } else if (negotiationStep === 1) {
      setChatLog(prev => [
        ...prev,
        { sender: 'vendor', text: `Thank you for reaching out. We appreciate the volume request. However, due to recent supply chain margins, our bottom-line rate is ₹${baseline.toLocaleString()} for ${currentRequest.productQty} units. Alternatively, we can offer ₹${midPoint.toLocaleString()} if the company clears invoices on Net-7 terms instead.`, timestamp }
      ]);
      setNegotiationStep(2);
    } else if (negotiationStep === 2) {
      setChatLog(prev => [
        ...prev,
        { sender: 'ai', text: `Our corporate accounting policy mandates Net-30 payment terms for compliance audit lines. Can we lock in at ₹${negotiated.toLocaleString()} per unit under Net-30 terms, and in return, we will mark Primus as our Primary Supplier for Q3 hardware renewals?`, timestamp }
      ]);
      setNegotiationStep(3);
    } else if (negotiationStep === 3) {
      const finalPrice = negotiated;
      setChatLog(prev => [
        ...prev,
        { sender: 'vendor', text: `We accept the volume proposal. Final price locked at ₹${finalPrice.toLocaleString()} per unit, Net-30 payment terms, including 3 Years On-Site Support. Registering the Rate Contract.`, timestamp }
      ]);
      setCurrentOfferPrice(finalPrice);
      setNegotiationComplete(true);
      setNegotiationStep(4);

      // Update request state with negotiated details
      setRequests(prev => prev.map(r => {
        if (r.id === selectedRequestId) {
          return {
            ...r,
            vendor: "Primus Technologies",
            savings: (baseline - finalPrice) * r.productQty,
            history: [...r.history, { title: "AI Negotiated", date: "Now", desc: `Final Price: ₹${finalPrice.toLocaleString()} (Net-30)` }]
          };
        }
        return r;
      }));
    }
  };

  const resetNegotiation = () => {
    setChatLog([]);
    setNegotiationStep(0);
    setCurrentOfferPrice(getNegotiationBaselinePrice(currentRequest.productName));
    setNegotiationComplete(false);
  };

  // The API is bearer-authenticated: without a token there is nothing to show.
  // The landing screen below (scene 1) *is* the sign-in gate now, so an
  // unauthenticated visitor is held there rather than sent to a second form.
  const signedOut = !authToken;

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 relative overflow-hidden login-aurora text-textPrimary`}>
      {/* Background ambient decorative glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full ambient-glow-1 filter blur-[120px] pointer-events-none opacity-60 z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full ambient-glow-2 filter blur-[120px] pointer-events-none opacity-60 z-0" />
      {/* Rotating prismatic holographic sweep (same as the login) */}
      <div className="login-sweep absolute inset-[-50%] z-0 pointer-events-none opacity-70" />

      {/* --- SCENE 1: Sign in with an ERP account --- */}
      {(signedOut || activeScene === 1) && (
        <div className="flex-grow flex flex-col lg:flex-row min-h-screen login-aurora relative overflow-hidden">
          {/* Holographic decorative layers span the whole login page */}
          <div className="login-sweep absolute inset-[-50%] z-0 pointer-events-none" />
          <div className="login-wash absolute inset-0 z-0 pointer-events-none" />
          <div className="absolute -top-24 -left-20 w-96 h-96 rounded-full bg-[#C4B5FD]/30 blur-[90px] z-0 pointer-events-none" />
          <div className="absolute top-1/3 right-1/3 w-[34rem] h-[34rem] rounded-full bg-[#CBB0F5]/24 blur-[110px] z-0 pointer-events-none" />
          <div className="absolute bottom-[-6rem] left-1/4 w-[28rem] h-[28rem] rounded-full bg-[#CDBDFF]/20 blur-[100px] z-0 pointer-events-none" />

          <div className="lg:w-7/12 flex flex-col justify-between p-8 lg:p-16 text-textPrimary relative z-10">
            <div className="relative z-10 flex items-center space-x-2">
              <div className="h-10 w-10 rounded-xl bg-brand flex items-center justify-center shadow-lg ring-1 ring-white/25">
                <Sparkles className="h-5 w-5 text-onbrand" />
              </div>
              <span className="font-outfit text-2xl font-bold tracking-tight">SmartSpend</span>
            </div>
            
            <div className="relative z-10 my-auto py-12 max-w-xl">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-brand/10 backdrop-blur-md border border-brand/20 text-brand uppercase tracking-widest shadow-sm">
                <span className="mr-2 h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_2px_rgba(124,108,246,0.45)]" />
                AI Orchestration Gateway
              </span>
              <h1 className="font-outfit text-4xl lg:text-6xl font-extrabold tracking-tight mt-6 leading-tight">
                Request Anything.<br />
                <span className="holo-text">Track Everything.</span>
              </h1>
              <p className="text-textSecondary text-lg mt-6 leading-relaxed">
                Experience corporate procurement simplified. SmartSpend abstracts complex procurement processes into a single, intelligent workspace. No forms, no jargon, no training required.
              </p>
            </div>
            
            <div className="relative z-10 flex items-center justify-between text-xs text-textFaint">
              <span>Powered by SmartSpend</span>
              <span>CONFIDENTIAL PROTOTYPE V2</span>
            </div>
          </div>
          
          <div className="lg:w-5/12 flex flex-col justify-center px-6 py-12 md:px-10 lg:px-14 relative z-10">
            <div className="max-w-md w-full mx-auto space-y-8 bg-white/70 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-xl p-8 lg:p-10">
              <div>
                <h2 className="font-outfit text-3xl font-extrabold text-textPrimary tracking-tight">Sign In</h2>
                <p className="mt-3 text-sm text-textSecondary">
                  Use your SmartSpend account. Your portal is decided by the role your account holds.
                </p>
              </div>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!authBusy && loginEmail && loginPassword) void signIn(loginEmail, loginPassword);
                }}
              >
                <div>
                  <label htmlFor="ss1-email" className="block text-[11px] font-bold uppercase tracking-wider text-textSecondary mb-2">
                    Email
                  </label>
                  <input
                    id="ss1-email"
                    type="email"
                    value={loginEmail}
                    autoComplete="username"
                    autoFocus
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-xl border border-borderTheme bg-white/70 px-3.5 py-2.5 text-sm text-textPrimary placeholder:text-textFaint outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                </div>

                <div>
                  <label htmlFor="ss1-pass" className="block text-[11px] font-bold uppercase tracking-wider text-textSecondary mb-2">
                    Password
                  </label>
                  <input
                    id="ss1-pass"
                    type="password"
                    value={loginPassword}
                    autoComplete="current-password"
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-borderTheme bg-white/70 px-3.5 py-2.5 text-sm text-textPrimary placeholder:text-textFaint outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                </div>

                {authError && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-neg/30 bg-neg/10 px-3 py-2.5 text-xs text-neg">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                    <span>{authError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authBusy || !loginEmail || !loginPassword}
                  className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-onbrand shadow-lg transition hover:brightness-110
                             disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/40"
                >
                  {authBusy ? "Signing in…" : "Sign in"}
                </button>
              </form>

            </div>
          </div>
        </div>
      )}
      
      {/* --- SCENES 2 - 12: INTEGRATED DEMO DASHBOARD LAYOUT --- */}
      {!signedOut && activeScene > 1 && (
        <div className="flex-grow flex overflow-hidden h-screen relative z-10">

          {/* Folded rail — the mark and the tabs, so the product is still named
              and every screen is still one click away. Unfolding is the same
              control that folded it, in the header. */}
          {!sidebarOpen && (
            <aside className="w-16 flex-shrink-0 flex flex-col items-center gap-1.5 py-4 border-r bg-surface border-borderTheme">
              <div className="h-9 w-9 rounded-lg bg-brand flex items-center justify-center mb-2" title="SmartSpend">
                <Sparkles className="h-5 w-5 text-onbrand" />
              </div>
              {userRole !== "Vendor" && navOrder[userRole]?.map(key => renderRailItem(userRole, key))}
              {userRole === "Vendor" && VENDOR_TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setActiveScene(18); setVendorTab(t.key); }}
                  title={t.label}
                  aria-label={t.label}
                  className={`relative grid h-10 w-10 place-items-center rounded-xl transition-all ${
                    activeScene === 18 && vendorTab === t.key
                      ? 'bg-brand text-onbrand' : 'text-textSecondary hover:bg-brand/10 hover:text-brand'}`}
                >
                  <t.icon className="h-5 w-5" />
                  {((t.key === 'approvals' && vendorAwaiting.length > 0)
                    || (t.key === 'auctions' && vendorAuctionCount > 0)) && (
                    <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-gold" />
                  )}
                </button>
              ))}

              {/* Signing out is how you change role, so it has to be reachable
                  folded too. Pushed to the foot of the rail, where it sits when
                  the sidebar is open. */}
              <button
                onClick={async () => {
                  setActiveScene(1);
                  await signOut();
                  setLoginEmail("");
                  setLoginPassword("");
                  setAuthError("");
                }}
                title="Sign out"
                aria-label="Sign out"
                className="mt-auto grid h-10 w-10 place-items-center rounded-xl border border-borderTheme bg-secondary text-textSecondary hover:text-primary transition-all"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </aside>
          )}

          {/* LEFT SIDEBAR */}
          {sidebarOpen && (
            <aside className={`w-64 flex-shrink-0 flex flex-col justify-between border-r bg-surface border-borderTheme`}>
              <div>
                {/* The fold control lives in the header alone. Two of them, one
                    here and one there, did the same thing from two places. */}
                <div className="p-6 flex items-center border-b border-borderTheme/40">
                  <div className="flex items-center space-x-2">
                    <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
                      <Sparkles className="h-4.5 w-4.5 text-onbrand" />
                    </div>
                    <span className="holo-text font-outfit font-bold text-lg tracking-tight">SmartSpend</span>
                  </div>
                </div>
                
                {/* Navigation Items (Role-Adaptive) */}
                <nav className="p-4 space-y-1.5">
                  <span className="text-[10px] text-textFaint font-bold uppercase tracking-wider block px-3 mb-2">Portal Navigation</span>
                  
                  {/* Role-adaptive nav — drag to reorder; top item is the login landing (#5) */}
                  {userRole !== "Vendor" && (navOrder[userRole]?.length ?? 0) > 1 && (
                    <span className="text-[9px] text-textFaint px-3 flex items-center gap-1 mb-1"><Layers className="h-3 w-3" /> Drag to reorder · top tab loads first on login</span>
                  )}
                  {userRole !== "Vendor" && navOrder[userRole]?.map((key, idx) => renderNavItem(userRole, key, idx))}

                  {userRole === "Vendor" && VENDOR_TABS.map(t => {
                    const active = activeScene === 18 && vendorTab === t.key;
                    const count = t.key === 'orders' ? vendorOrders.length
                      : t.key === 'receipts' ? vendorReceipts.length
                        : t.key === 'auctions' ? vendorAuctionCount : vendorAwaiting.length;
                    return (
                      <button
                        key={t.key}
                        onClick={() => { setActiveScene(18); setVendorTab(t.key); }}
                        className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                          active ? 'bg-brand text-onbrand' : 'text-textSecondary hover:bg-brand/10 hover:text-brand'}`}
                      >
                        <t.icon className="h-4 w-4" />
                        <span>{t.label}</span>
                        {count > 0 && (
                          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            active ? 'bg-white/20 text-onbrand'
                              : t.key === 'approvals' ? 'bg-gold/20 text-gold border border-gold/30'
                                : 'bg-secondary text-textSecondary'}`}>{count}</span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
              
              {/* Bottom Quick Controls */}
              <div className="p-4 space-y-3 border-t border-borderTheme">
                {/* Dark/light theme toggle disabled — light theme only for now.
                    Re-enable together with the darkMode state (App.tsx) above.
                <div className="flex items-center justify-between text-[11px] text-textFaint px-2">
                  <span className="font-semibold uppercase tracking-wider">Appearance</span>
                  <button
                    onClick={() => setDarkMode(!darkMode)}
                    aria-label="Toggle color theme"
                    className="relative inline-flex h-7 w-[52px] items-center rounded-full border border-borderTheme bg-secondary transition-colors"
                  >
                    <span
                      className={`absolute flex h-5 w-5 items-center justify-center rounded-full bg-brand text-onbrand shadow transition-transform duration-300 ${darkMode ? 'translate-x-[3px]' : 'translate-x-[27px]'}`}
                    >
                      {darkMode ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                    </span>
                  </button>
                </div>
                */}

                {/* Sign out ONLY. This used to also wipe and re-seed every
                    request in ERP, and because it is the way you switch users,
                    every switch destroyed the work in progress. Resetting the
                    demo data is a separate, deliberate button below. */}
                <button
                  onClick={async () => {
                    setActiveScene(1);
                    // The two release steps used to be cleared here, because
                    // they were component state and the next user would have
                    // inherited them. They are on the request now, so signing
                    // out leaves them where they belong.
                    await signOut();
                    setLoginEmail("");
                    setLoginPassword("");
                    setAuthError("");
                  }}
                  className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg border border-borderTheme bg-secondary hover:bg-secondary text-[11px] text-textSecondary hover:text-primary font-medium transition-all"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                  <span>Sign out</span>
                </button>

                {/* Destructive and rare: deletes every request and re-seeds the
                    walkthrough set. Two clicks, and only for accounts ERP would
                    actually let do it. */}
                {(currentUser?.is_manager || userRole === 'Manager' || userRole === 'CEO') && (
                  resetArmed ? (
                    <div className="space-y-1.5 rounded-lg border border-neg/40 bg-neg/5 p-2">
                      <p className="text-[10px] text-neg font-semibold leading-snug">
                        Delete all {requests.length} requests and re-seed the demo set? This cannot be undone.
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={async () => { setResetArmed(false); await resetOdooDatabase(); }}
                          className="flex-1 py-1.5 rounded-md bg-neg text-onbrand text-[10px] font-bold"
                        >
                          Delete &amp; re-seed
                        </button>
                        <button
                          onClick={() => setResetArmed(false)}
                          className="flex-1 py-1.5 rounded-md bg-secondary border border-borderTheme text-[10px] font-bold text-textSecondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setResetArmed(true)}
                      className="w-full flex items-center justify-center space-x-2 py-1.5 px-3 rounded-lg border border-borderTheme bg-transparent text-[10px] text-textFaint hover:text-neg hover:border-neg/40 font-medium transition-all"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Reset demo data</span>
                    </button>
                  )
                )}
                
                <div className="flex items-center justify-between text-[11px] text-textFaint px-2 py-1 bg-secondary/30 rounded-lg border border-borderTheme/50 mt-2">
                  <span className="font-semibold uppercase tracking-wider">Server</span>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-medium text-textSecondary">
                      {offlineDemo ? 'Demo data' : odooConnected ? 'Connected' : 'Disconnected'}
                    </span>
                    <span className={`h-2 w-2 rounded-full ${
                      offlineDemo ? 'bg-gold' : odooConnected ? 'bg-pos animate-pulse' : 'bg-neg'}`} />
                  </div>
                </div>
                {/* Said outright, not left to a status dot. A demo that passes
                    sample data off as saved records is worse than one that
                    admits what it is. */}
                {offlineDemo && (
                  <p className="mt-2 px-2 py-1.5 rounded-lg bg-gold/10 border border-gold/25 text-[10px] leading-snug text-textSecondary">
                    <span className="font-bold text-textPrimary">Sample data.</span>{' '}
                    No server is connected, so nothing here is saved — every change
                    lives in this browser until you reload.
                  </p>
                )}
              </div>
            </aside>
          )}
          
          {/* MAIN WORKSPACE CONTENT */}
          <main className="flex-grow flex flex-col min-w-0 overflow-y-auto">
            
            {/* TOP NAVIGATION HEADER — sidebar toggle and the current screen.
                The DEMO STEP picker and its Back / Next Step buttons were removed:
                the app is navigated through the sidebar and the in-screen buttons,
                the way the real product is. */}
            <header className={`h-16 px-6 border-b flex items-center justify-between flex-shrink-0 bg-surface/80 backdrop-blur-md border-borderTheme`}>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-2 rounded-lg hover:bg-secondary text-textSecondary hover:text-primary"
                >
                  <Menu className="h-5 w-5" />
                </button>

                <div className="h-4 w-[1px] bg-raised" />

                <span className="text-sm font-bold text-textPrimary">
                  {SCENES.find(s => s.id === activeScene)?.name.replace(/^Scene \d+:\s+/, '')}
                </span>
              </div>
            </header>


            {/* WORKSPACE AREA */}
            <div className="px-4 md:px-6 py-6 flex-grow">
              {/* Poke reminders targeted at the current role (#10) */}
              {pokes.some(p => p.to === userRole) && (
                <div className="mb-6 space-y-2 max-w-6xl mx-auto">
                  {pokes.map((p, i) => p.to !== userRole ? null : (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl border shadow-sm animate-fadeIn" style={{ background: '#6356A814', borderColor: '#6356A840' }}>
                      <span className="h-8 w-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0"><Bell className="h-4 w-4 text-brand" /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-textPrimary">Reminder from {p.from}</p>
                        <p className="text-[11px] text-textSecondary truncate">{p.message}</p>
                      </div>
                      <button onClick={() => { setSelectedRequestId(p.reqId); if (userRole === 'Manager') setActiveScene(10); else if (userRole === 'SCM Buyer') setActiveScene(6); }} className="text-[11px] font-semibold text-brand hover:underline flex-shrink-0 px-1">View</button>
                      <button onClick={() => setPokes(prev => prev.filter((_, idx) => idx !== i))} className="text-textFaint hover:text-textPrimary flex-shrink-0"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              )}
              {/* Calls ERP would not take. These sit until they are retried or
                  dismissed: while one is up, what is on screen is not what the
                  backend holds. */}
              {syncErrors.length > 0 && (
                <div className="mb-6 space-y-2 max-w-6xl mx-auto">
                  {syncErrors.map(err => (
                    <div key={err.key} className="flex items-start gap-3 p-3 rounded-xl border shadow-sm animate-fadeIn bg-neg/10 border-neg/30">
                      <span className="h-8 w-8 rounded-full bg-neg/15 flex items-center justify-center flex-shrink-0"><AlertTriangle className="h-4 w-4 text-neg" /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-textPrimary">{err.id} — {err.what}</p>
                        <p className="text-[11px] text-textSecondary">{err.message}</p>
                      </div>
                      <button
                        onClick={() => err.retry()}
                        className="text-[11px] font-semibold text-neg hover:underline flex-shrink-0 px-1 mt-0.5"
                      >
                        Retry
                      </button>
                      <button onClick={() => clearSyncError(err.key)} className="text-textFaint hover:text-textPrimary flex-shrink-0 mt-0.5"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              )}
              {pokeToast && (
                <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-surface border border-brand/30 shadow-xl text-sm font-semibold text-textPrimary animate-fadeIn">
                  {pokeToast}
                </div>
              )}

              {/* Waiting on you: raised on sign-in when this role already has
                  work queued. Built from the requests themselves, so it does
                  not matter who submitted them or whether the page was
                  refreshed since. Picking one opens it where it can be acted
                  on, selected and scrolled to. */}
              {inboxAlert && inboxAlert.length > 0 && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-textPrimary/40 backdrop-blur-sm animate-fadeIn"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="inbox-title"
                  onClick={() => setInboxAlert(null)}
                >
                  <div
                    className="w-full max-w-xl rounded-2xl bg-surface border border-borderTheme shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-6 pb-4 border-b border-borderTheme flex items-start gap-4">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold shrink-0">
                        <Bell className="h-6 w-6" />
                      </span>
                      <div className="min-w-0">
                        <h3 id="inbox-title" className="font-outfit text-xl font-extrabold text-textPrimary leading-tight">
                          {inboxAlert.length} request{inboxAlert.length > 1 ? 's' : ''} waiting on you
                        </h3>
                        <p className="text-xs text-textSecondary mt-1">
                          {userRole === 'Manager' ? 'These need your approval. The newest is first.'
                            : userRole === 'SCM Buyer' ? 'These are approved and waiting to be sourced. The newest is first.'
                            : userRole === 'Vendor' ? 'These purchase orders are waiting for your acknowledgment.'
                            : 'Your approver has asked you a question on these.'}
                          {' '}Pick one to open it.
                        </p>
                      </div>
                    </div>

                    <div className="overflow-y-auto divide-y divide-borderTheme">
                      {inboxAlert.map((r, i) => (
                        <button
                          key={r.id}
                          onClick={() => openForAction(r)}
                          className="w-full text-left px-6 py-4 hover:bg-secondary/70 transition-colors flex items-center gap-4 group"
                        >
                          <div className="min-w-0 flex-grow">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] font-bold text-textFaint">{r.id}</span>
                              {i === 0 && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/20 text-gold border border-gold/30">
                                  Latest
                                </span>
                              )}
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: `rgb(${statusRgb(r.status)} / 0.12)`, color: statusColor(r.status) }}
                              >
                                {r.status}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-textPrimary mt-1 truncate">
                              {r.productQty}× {reqSummary(r)}
                            </p>
                            <p className="text-[11px] text-textSecondary mt-0.5 truncate">
                              {r.department} · {r.location} · {r.createdDate}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-extrabold text-textPrimary tabular-nums">
                              ₹{r.totalCost.toLocaleString('en-IN')}
                            </p>
                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand">
                              {userRole === 'Manager' ? 'Review' : 'Open'}
                              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-3 px-6 py-4 bg-secondary/50 border-t border-borderTheme">
                      <span className="text-[11px] text-textFaint">
                        Total ₹{inboxAlert.reduce((s, r) => s + r.totalCost, 0).toLocaleString('en-IN')}
                      </span>
                      <button
                        onClick={() => setInboxAlert(null)}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-surface text-textSecondary border border-borderTheme hover:text-textPrimary transition-all"
                      >
                        Later
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Submitted: what happens next, and who has it now. Raised the
                  moment a requisition becomes a request, because until now the
                  requester was dropped on the next screen with no confirmation
                  that anything had been sent or who was expected to act. */}
              {submittedInfo && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-textPrimary/40 backdrop-blur-sm animate-fadeIn"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="submitted-title"
                  onClick={() => setSubmittedInfo(null)}
                >
                  <div
                    className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-2xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-6 pb-5 border-b border-borderTheme">
                      <div className="flex items-start gap-4">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-pos/10 text-pos shrink-0">
                          <CheckCircle2 className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                          <h3 id="submitted-title" className="font-outfit text-xl font-extrabold text-textPrimary leading-tight">
                            {offlineDemo ? 'Request raised — in this browser only' : 'Request sent for approval'}
                          </h3>
                          <p className="text-xs text-textSecondary mt-1">
                            <span className="font-mono font-bold text-textPrimary">{submittedInfo.id}</span>
                            {' · '}{submittedInfo.product}
                            {submittedInfo.lines > 1 ? ` +${submittedInfo.lines - 1} more` : ''}
                            {' · '}₹{submittedInfo.total.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      {/* Nothing was sent anywhere, so do not say it was. This
                          dialog claiming "your manager has been notified" while
                          the request existed only in the browser is exactly how
                          a lost record looks like a saved one. */}
                      {offlineDemo ? (
                        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-gold/10 border border-gold/30 px-3.5 py-3">
                          <AlertTriangle className="h-4 w-4 text-gold shrink-0 mt-0.5" />
                          <p className="text-xs text-textSecondary">
                            <strong className="text-textPrimary">No server is connected</strong>, so this
                            request was not saved and nobody has been notified. It lives in this
                            browser until you reload. Point the portal at a running server — the
                            backend URL is on the sign-in screen — and raise it again to record it
                            for real.
                          </p>
                        </div>
                      ) : (
                      <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-brand/5 border border-brand/20 px-3.5 py-3">
                        <Bell className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                        <p className="text-xs text-textSecondary">
                          {submittedInfo.breach ? (
                            <>This request is over its department budget, so it has gone back for
                            clarification. Your <strong className="text-textPrimary">{submittedInfo.owner}</strong> has
                            been notified and will come back to you with a question.</>
                          ) : (
                            <>Your <strong className="text-textPrimary">{submittedInfo.owner}</strong> has been
                            notified and it is waiting on them now. You do not need to do anything
                            unless they ask you a question.</>
                          )}
                          {/* Name the account. The chain routes by designation,
                              and "Finance CapEx Head" is not something anyone
                              can sign in as. */}
                          {submittedInfo.signIn && (
                            <span className="block mt-1.5 text-textFaint">
                              To approve it, sign in as{' '}
                              <strong className="text-brand font-mono">{submittedInfo.signIn}</strong>.
                            </span>
                          )}
                        </p>
                      </div>
                      )}
                    </div>

                    <div className="px-6 py-5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-3">What happens next</p>
                      <ol className="space-y-3">
                        {NEXT_STEPS.map((s, i) => (
                          <li key={s.stage} className="flex items-start gap-3">
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold border ${
                              i === 0 ? 'bg-brand text-onbrand border-transparent' : 'bg-secondary text-textFaint border-borderTheme'}`}>
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-textPrimary">
                                {s.stage}
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-textFaint">{s.owner}</span>
                                {i === 0 && (
                                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">
                                    Now
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-textSecondary mt-0.5">{s.note}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-secondary/50 border-t border-borderTheme">
                      <button
                        onClick={() => setSubmittedInfo(null)}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-surface text-textSecondary border border-borderTheme hover:text-textPrimary transition-all"
                      >
                        Got it
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRequestId(submittedInfo.id);
                          setSubmittedInfo(null);
                          setActiveScene(11);
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-brand text-onbrand hover:brightness-110 transition-all flex items-center gap-1.5"
                      >
                        Track this request
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* --- SCENE 2: EMPLOYEE PORTAL (CONSOLIDATED INPUT & TABS) --- */}
              {activeScene === 2 && (
                <div className="space-y-6 animate-fadeIn">
                  
                  {/* Employee Tabs Bar */}
                  <div className="flex border-b border-borderTheme">
                    <button 
                      onClick={() => setEmployeeTab('chat')}
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${employeeTab === 'chat' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      New Request
                    </button>
                    <button 
                      onClick={() => setEmployeeTab('list')} 
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${employeeTab === 'list' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      My Requests
                    </button>
                    <button 
                      onClick={() => setEmployeeTab('tracking')}
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${employeeTab === 'tracking' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      Track Request
                    </button>
                    <button
                      onClick={() => setEmployeeTab('clarify')}
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${employeeTab === 'clarify' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      Questions
                    </button>
                  </div>

                  {/* Tab 1: Raise Request (ChatGPT/WhatsApp Consolidated Search Style) */}
                  {employeeTab === 'chat' && (
                    <div className="max-w-6xl mx-auto space-y-12 py-10">
                      <div className="text-center space-y-3">
                        <h2 className="font-outfit text-4xl font-extrabold tracking-tight text-primary">What do you need today?</h2>
                        <p className="text-base text-textSecondary">Ask for any item or service in plain words — we handle the rest.</p>
                      </div>

                      {/* File Attached Success Banner */}
                      {attachedFiles.length > 0 && (
                        <div className="p-3 bg-brand/10 border border-brand/25 rounded-xl space-y-2 animate-fadeIn">
                          <span className="flex items-center gap-2 text-xs font-bold text-brand">
                            <Paperclip className="h-4 w-4" />
                            {attachedFiles.length} file{attachedFiles.length === 1 ? '' : 's'} attached
                            <span className="font-medium text-textFaint">· uploaded when the request is raised</span>
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {attachedFiles.map(f => (
                              <span key={f.name} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface border border-borderTheme text-[11px] text-textSecondary">
                                {f.name}
                                <button
                                  onClick={() => setAttachedFiles(prev => prev.filter(x => x.name !== f.name))}
                                  title={`Remove ${f.name}`}
                                  className="text-textFaint hover:text-neg"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Multi-product composer + AI sub-category suggestions, stacked above the bar */}
                      <div className="max-w-3xl mx-auto w-full space-y-3">
                        {chatItems.length > 0 && (
                          <div className="p-3 rounded-2xl bg-surface border border-borderTheme shadow-sm space-y-2 animate-fadeIn">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Products in this request ({chatItems.length})</span>
                              <button type="button" onClick={() => setChatItems([])} className="text-[10px] font-semibold text-textSecondary hover:text-neg">Clear all</button>
                            </div>
                            {chatItems.map((it, idx) => (
                              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                <input
                                  type="text"
                                  value={it.productName}
                                  onChange={(e) => setChatItems(prev => prev.map((x, i) => i === idx ? { ...x, productName: e.target.value } : x))}
                                  placeholder="Product description"
                                  className="col-span-8 bg-secondary border border-line2 rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-brand"
                                />
                                <div className="col-span-3 flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min={1}
                                    value={it.productQty}
                                    onChange={(e) => setChatItems(prev => prev.map((x, i) => i === idx ? { ...x, productQty: Number(e.target.value) } : x))}
                                    className="w-full bg-secondary border border-line2 rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-brand"
                                  />
                                  <span className="text-[10px] text-textFaint">qty</span>
                                </div>
                                <button type="button" onClick={() => setChatItems(prev => prev.filter((_, i) => i !== idx))} className="col-span-1 flex justify-center text-textFaint hover:text-neg" title="Remove product">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between pt-1">
                              <button type="button" onClick={() => setChatItems(prev => [...prev, { productName: '', productQty: 1, targetPrice: 0 }])}
                                className="text-[11px] font-semibold text-brand hover:underline flex items-center gap-1"><span className="text-sm leading-none">+</span> Add another product</button>
                              <span className="text-[10px] text-textFaint">{linesQty(chatItems)} units staged</span>
                            </div>
                          </div>
                        )}

                        {/* Sub-product categories the AI infers from what's being typed */}
                        {(() => {
                          const cat = subCatalogFor(chatInputText);
                          if (!cat) return null;
                          const staged = new Set(chatItems.map(i => i.productName));
                          return (
                            <div className="px-1 space-y-2 animate-fadeIn">
                              <span className="text-[11px] text-textSecondary flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-brand" />
                                Detected <strong className="text-textPrimary">{cat.category}</strong> — commonly requested together:
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {cat.items.map(name => (
                                  <button
                                    key={name}
                                    type="button"
                                    disabled={staged.has(name)}
                                    onClick={() => setChatItems(prev => [...prev, { productName: name, productQty: 1, targetPrice: 0 }])}
                                    className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-all ${staged.has(name)
                                      ? 'bg-brand/10 border-brand/30 text-brand cursor-default'
                                      : 'bg-surface border-borderTheme text-textSecondary hover:border-brand hover:text-brand'}`}
                                  >
                                    {staged.has(name) ? '✓ ' : '+ '}{name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Unified Input Bar (Matching user's attachment screenshot exactly) */}
                        <form onSubmit={handleChatSubmit} className="relative flex items-center bg-surface border border-borderTheme/70 rounded-full px-5 py-3.5 focus-within:border-brand/60 shadow-xl transition-all w-full">
                          {/* Attach button — opens the picker below */}
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={e => handleFilesPicked(e.target.files)}
                          />
                          <button 
                            type="button"
                            onClick={handleAttachmentAdd}
                            className="p-1.5 rounded-full hover:bg-secondary text-textSecondary hover:text-textPrimary transition-all mr-3"
                            title="Add attachment"
                          >
                            <Paperclip className="h-5 w-5" />
                          </button>

                          {/* Text input area */}
                          <input 
                            type="text"
                            value={chatInputText}
                            onChange={(e) => setChatInputText(e.target.value)}
                            placeholder="Mention the product, branch, quantity and expected delivery date…"
                            className="flex-grow bg-transparent text-sm text-primary placeholder-textFaint focus:outline-none pr-28"
                          />

                          {/* Integration Logos & Voice Action Group */}
                          <div className="absolute right-3 flex items-center space-x-2">
                            <span className="text-textFaint font-bold text-lg">|</span>

                            {/* Voice Mic Icon */}
                            <button
                              type="button"
                              onClick={() => setActiveScene(3)}
                              className="p-1.5 rounded-full hover:bg-secondary text-textSecondary hover:text-primary transition-all"
                              title="Voice Procurement"
                            >
                              <Mic className="h-4.5 w-4.5" />
                            </button>

                            {/* Send Button */}
                            <button 
                              type="submit"
                              className="p-2 rounded-full bg-brand hover:bg-brand text-onbrand transition-all"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </form>
                      </div>

                      {/* Suggested Prompts */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-6 max-w-3xl mx-auto">
                        <div 
                          onClick={() => setChatInputText("I need 20 Dell Latitude laptops for the Bangalore office")}
                          className="cursor-pointer p-4 rounded-xl bg-surface/60 border border-borderTheme hover:border-line2 transition-all text-left text-xs space-y-1"
                        >
                          <span className="font-semibold text-textPrimary block">💻 Request IT Hardware</span>
                          <span className="text-textSecondary">"I need 20 Dell Latitude laptops for the Bangalore office..."</span>
                        </div>
                        <div 
                          onClick={() => setChatInputText("Requesting 10 ergonomic conference chairs for the Mumbai office")}
                          className="cursor-pointer p-4 rounded-xl bg-surface/60 border border-borderTheme hover:border-line2 transition-all text-left text-xs space-y-1"
                        >
                          <span className="font-semibold text-textPrimary block">🪑 Request Office Furniture</span>
                          <span className="text-textSecondary">"Requesting 10 ergonomic conference chairs for Mumbai..."</span>
                        </div>
                      </div>

                      {/* My Requests — status dots + search + redesigned cards (#2) */}
                      {(() => {
                        const homeFiltered = filterRequests(requests, homeStatusFilter, homeSearch);
                        return (
                          <div className="pt-8">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                              <div className="flex items-center gap-3 flex-wrap">
                                <h3 className="font-outfit text-xl font-extrabold text-textPrimary">My Requests <span className="text-textFaint font-semibold">({homeFiltered.length})</span></h3>
                                <StatusDots value={homeStatusFilter} onChange={setHomeStatusFilter} requests={requests} />
                              </div>
                              <div className="flex items-center gap-3">
                                <RequestSearch value={homeSearch} onChange={setHomeSearch} />
                                <ViewToggle value={requestView} onChange={setRequestView} />
                                <button onClick={() => setEmployeeTab('list')} className="text-sm font-semibold text-brand hover:underline whitespace-nowrap">View all</button>
                              </div>
                            </div>
                            {homeFiltered.length === 0 ? (
                              <div className="p-10 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                                <Search className="h-7 w-7 mx-auto text-textFaint mb-2" />
                                <p className="text-sm font-semibold text-textPrimary">No requests match your filters</p>
                                <p className="text-xs text-textFaint mt-1">Try a different keyword or status.</p>
                              </div>
                            ) : (
                              requestView === 'list' ? (
                                <RequestRows
                                  rows={homeFiltered}
                                  onOpen={(r) => { setSelectedRequestId(r.id); setEmployeeTab('tracking'); }}
                                />
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                  {homeFiltered.map(r => (
                                    <RequestCard
                                      key={r.id}
                                      r={r}
                                      onOpen={() => { setSelectedRequestId(r.id); setEmployeeTab('tracking'); }}
                                      onPoke={() => handlePoke(r)}
                                    />
                                  ))}
                                </div>
                              )
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Tab 2: My Requests — full list, same card + filters as the home grid */}
                  {employeeTab === 'list' && (() => {
                    const listFiltered = filterRequests(requests, homeStatusFilter, homeSearch);
                    return (
                      <div className="space-y-4 animate-fadeIn">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="font-outfit font-extrabold text-xl text-primary">Your Requests <span className="text-textFaint font-semibold">({listFiltered.length})</span></h3>
                            <span className="text-xs text-textFaint">Tap any request to see where it is</span>
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <StatusDots value={homeStatusFilter} onChange={setHomeStatusFilter} requests={requests} />
                            <RequestSearch value={homeSearch} onChange={setHomeSearch} />
                            <ViewToggle value={requestView} onChange={setRequestView} />
                          </div>
                        </div>

                        {listFiltered.length === 0 ? (
                          <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                            <Search className="h-8 w-8 mx-auto text-textFaint mb-2" />
                            <p className="text-sm font-semibold text-textPrimary">No requests match your filters</p>
                            <p className="text-xs text-textFaint mt-1">Try a different keyword or status.</p>
                          </div>
                        ) : (
                          requestView === 'list' ? (
                            <RequestRows
                              rows={listFiltered}
                              onOpen={(r) => { setSelectedRequestId(r.id); setEmployeeTab('tracking'); }}
                            />
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {listFiltered.map(r => (
                                <RequestCard
                                  key={r.id}
                                  r={r}
                                  onOpen={() => { setSelectedRequestId(r.id); setEmployeeTab('tracking'); }}
                                  onPoke={() => handlePoke(r)}
                                />
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    );
                  })()}

                  {/* Tab 3: Request Tracking (Selected Requisition Timeline) */}
                  {employeeTab === 'tracking' && (
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-6 animate-fadeIn">
                      <div className="flex justify-between items-center border-b border-borderTheme pb-4">
                        <div>
                          <span className="text-xs text-brand font-bold block">{currentRequest.id} Tracking</span>
                          <h3 className="font-outfit font-extrabold text-xl text-primary">{currentRequest.productQty}x {reqSummary(currentRequest)}</h3>
                        </div>
                        <span className="px-3 py-1 bg-secondary rounded-full border border-borderTheme text-xs font-bold text-textSecondary">
                          Status: {currentRequest.status}
                        </span>
                      </div>

                      {/* Timeline Nodes */}
                      <div className="relative flex justify-between items-center max-w-2xl mx-auto py-6">
                        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-secondary z-0" />
                        
                        {/* Dynamic Progress indicator */}
                        <div 
                          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-pos z-0 transition-all duration-500" 
                          style={{ 
                            width: currentRequest.status === 'PO Confirmed' ? '100%' :
                                   currentRequest.status === 'Approved' ? '75%' :
                                   currentRequest.status === 'Sourcing' ? '50%' : '25%' 
                          }} 
                        />

                        {/* Node 1: Request Submitted */}
                        <div className="flex flex-col items-center z-10 text-center space-y-1.5">
                          <div className="h-8 w-8 rounded-full bg-pos text-onbrand flex items-center justify-center font-bold text-xs">
                            <Check className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] font-bold text-textPrimary block">Submitted</span>
                        </div>

                        {/* Node 2: Sourcing Mapped */}
                        <div className="flex flex-col items-center z-10 text-center space-y-1.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            ['Sourcing', 'Approved', 'PO Confirmed'].includes(currentRequest.status) ? 'bg-pos text-onbrand' : 'bg-secondary text-textFaint border border-line2'
                          }`}>
                            {['Sourcing', 'Approved', 'PO Confirmed'].includes(currentRequest.status) ? <Check className="h-4 w-4" /> : '2'}
                          </div>
                          <span className="text-[10px] font-bold text-textPrimary block">Sourcing</span>
                        </div>

                        {/* Node 3: Manager Approved */}
                        <div className="flex flex-col items-center z-10 text-center space-y-1.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            ['Approved', 'PO Confirmed'].includes(currentRequest.status) ? 'bg-pos text-onbrand' : 'bg-secondary text-textFaint border border-line2'
                          }`}>
                            {['Approved', 'PO Confirmed'].includes(currentRequest.status) ? <Check className="h-4 w-4" /> : '3'}
                          </div>
                          <span className="text-[10px] font-bold text-textPrimary block">Approved</span>
                        </div>

                        {/* Node 4: PO Confirmed */}
                        <div className="flex flex-col items-center z-10 text-center space-y-1.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            currentRequest.status === 'PO Confirmed' ? 'bg-pos text-onbrand' : 'bg-secondary text-textFaint border border-line2'
                          }`}>
                            {currentRequest.status === 'PO Confirmed' ? <Check className="h-4 w-4" /> : '4'}
                          </div>
                          <span className="text-[10px] font-bold text-textPrimary block">PO Sent</span>
                        </div>
                      </div>

                      {/* Requested products */}
                      <div className="border-t border-borderTheme/80 pt-6">
                        <LineItemsTable lines={reqLines(currentRequest)} title="Requested products" totalLabel="Request Value" />
                      </div>

                      {/* Audit Log / History */}
                      <div className="border-t border-borderTheme/80 pt-6 max-w-xl mx-auto space-y-3">
                        <span className="text-xs font-bold text-textFaint uppercase tracking-wider block">Event Log</span>
                        {currentRequest.history.map((h, idx) => (
                          <div key={idx} className="p-3 bg-secondary/45 border border-borderTheme rounded-xl flex items-start justify-between text-xs">
                            <div>
                              <span className="font-bold text-textPrimary block">{h.title}</span>
                              <span className="text-textSecondary mt-0.5 block">{h.desc}</span>
                            </div>
                            <span className="text-[10px] text-textFaint">{h.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tab 4: Clarification Inbox */}
                  {employeeTab === 'clarify' && (
                    <div className="space-y-6 animate-fadeIn">
                      <h3 className="font-outfit font-extrabold text-xl text-primary">Clarification Requests</h3>
                      
                      {requests.filter(r => r.status === 'Needs Clarification').length === 0 ? (
                        <div className="p-8 text-center bg-surface/40 border border-borderTheme rounded-2xl text-textSecondary">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-pos mb-2" />
                          <p className="text-sm font-semibold">Your inbox is clear!</p>
                          <p className="text-xs mt-1">No manager queries pending clarification.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {requests.filter(r => r.status === 'Needs Clarification').map(req => (
                            <div key={req.id} className="p-6 rounded-2xl bg-surface border border-gold/30 space-y-4">
                              <div className="flex items-center justify-between border-b border-borderTheme pb-3">
                                <div>
                                  <span className="text-xs text-gold font-bold block">{req.id}</span>
                                  <h4 className="font-outfit font-extrabold text-lg text-primary">{req.productQty}x {reqSummary(req)}</h4>
                                </div>
                                <span className="px-2 py-0.5 bg-gold/10 text-gold border border-gold/25 rounded-md text-[10px] font-bold">RFI PENDING</span>
                              </div>

                              {/* Manager Comment Display */}
                              <div className="p-4 bg-secondary border border-borderTheme rounded-xl">
                                <span className="text-[10px] text-textFaint font-bold uppercase tracking-wider block">Manager Query:</span>
                                <p className="text-xs text-textSecondary mt-1 font-medium italic">
                                  "{req.clarificationComments[req.clarificationComments.length - 1]?.text || 'Please provide details.'}"
                                </p>
                              </div>

                              {/* Reply form */}
                              <div className="space-y-2">
                                <label className="text-[10px] text-textFaint font-bold uppercase tracking-wider block">Your Response / Clarification</label>
                                <textarea 
                                  rows={3}
                                  value={employeeReplyText}
                                  onChange={(e) => setEmployeeReplyText(e.target.value)}
                                  placeholder="Provide the requested details to re-submit for approval..."
                                  className="w-full bg-secondary border border-line2/60 rounded-xl p-3 text-xs text-primary focus:outline-none focus:border-brand"
                                />
                                <div className="flex justify-end pt-2">
                                  <button 
                                    onClick={() => handleEmployeeReplySubmit(req.id)}
                                    className="px-4 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all"
                                  >
                                    Submit Response
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
              
              {/* --- SCENE 3: VOICE ASSISTANT MODAL SIMULATOR --- */}
              {activeScene === 3 && (
                <div className="max-w-2xl mx-auto py-8 animate-fadeIn">
                  <div className="p-8 rounded-2xl border border-borderTheme bg-surface/60 backdrop-blur-xl shadow-2xl space-y-8 relative overflow-hidden">
                    <div className="absolute top-4 right-4 flex items-center space-x-2">
                      <Volume2 className="h-4 w-4 text-brand animate-bounce" />
                      <span className="text-xs text-brand font-bold uppercase tracking-wider">Voice Portal</span>
                    </div>
                    
                    <div className="text-center space-y-2">
                      <h2 className="font-outfit text-2xl font-extrabold text-primary">SmartSpend Voice Assistant</h2>
                      <p className="text-sm text-textSecondary max-w-md mx-auto font-medium">Click the microphone to simulate recording your purchase request details.</p>
                      <p className="text-xs text-textFaint max-w-md mx-auto">
                        Mention the <span className="text-textSecondary font-semibold">product</span>, <span className="text-textSecondary font-semibold">branch</span>, <span className="text-textSecondary font-semibold">quantity</span> and <span className="text-textSecondary font-semibold">expected delivery date</span> — the AI structures the rest.
                      </p>
                    </div>
                    
                    {/* Microphone Soundwave Visual Area */}
                    <div className="flex flex-col items-center justify-center py-6 space-y-4">
                      {voiceState === 'idle' && (
                        <button 
                          onClick={() => setVoiceState('listening')}
                          className="h-24 w-24 rounded-full bg-secondary hover:bg-brand text-textSecondary hover:text-onbrand flex items-center justify-center shadow-lg border border-line2/50 transition-all duration-300 hover:scale-105"
                        >
                          <Mic className="h-10 w-10" />
                        </button>
                      )}
                      
                      {voiceState === 'listening' && (
                        <div className="flex flex-col items-center space-y-4">
                          <button 
                            onClick={() => setVoiceState('processing')}
                            className="h-24 w-24 rounded-full bg-brand text-onbrand flex items-center justify-center relative shadow-2xl"
                          >
                            <span className="absolute inset-0 rounded-full bg-brand/40 animate-ping" />
                            <Mic className="h-10 w-10" />
                          </button>
                          
                          {/* Animated soundwaves */}
                          <div className="flex items-center space-x-1.5 h-10 py-1">
                            <div className="w-1 bg-brand rounded animate-[wave_0.8s_infinite_ease-in-out_delay-100] h-6" />
                            <div className="w-1 bg-brand rounded animate-[wave_0.8s_infinite_ease-in-out_delay-300] h-10" />
                            <div className="w-1 bg-brand rounded animate-[wave_0.8s_infinite_ease-in-out_delay-200] h-8" />
                            <div className="w-1 bg-brand rounded animate-[wave_0.8s_infinite_ease-in-out_delay-400] h-5" />
                            <div className="w-1 bg-brand rounded animate-[wave_0.8s_infinite_ease-in-out_delay-150] h-9" />
                          </div>
                          
                          <div className="text-center">
                            <span className="text-sm font-semibold text-brand">Listening...</span>
                            <span className="text-xs text-textFaint block mt-1">Simulated Duration: 0:0{voiceSeconds}</span>
                          </div>
                        </div>
                      )}
                      
                      {voiceState === 'processing' && (
                        <div className="flex flex-col items-center space-y-4">
                          <div className="h-24 w-24 rounded-full bg-brand/40 border border-brand/30 flex items-center justify-center">
                            <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                          </div>
                          <div className="text-center">
                            <span className="text-sm font-semibold text-brand">Transcribing Speech to Text...</span>
                            <span className="text-xs text-textFaint block mt-1 text-textSecondary">Analyzing Intent &amp; Catalog entities</span>
                          </div>
                        </div>
                      )}
                      
                      {voiceState === 'done' && (
                        <div className="w-full space-y-4">
                          <div className="p-4 bg-secondary/40 border border-line2/60 rounded-xl">
                            <p className="text-xs text-textFaint font-bold uppercase tracking-wider">Converted Text:</p>
                            <p className="text-sm text-textPrimary mt-2 font-medium italic">"{speechText}"</p>
                          </div>
                          
                          <div className="flex justify-center space-x-3">
                            <button 
                              onClick={() => { setVoiceState('idle'); setVoiceSeconds(0); setSpeechText(""); }}
                              className="px-4 py-2 border border-line2 hover:bg-secondary text-xs font-semibold rounded-lg text-textSecondary transition-all"
                            >
                              Record Again
                            </button>
                            <button 
                              onClick={async () => {
                                setIsParsing(true);
                                let parsedSuccessfully = false;
                                try {
                                  const res = await apiFetch(`/api/smartspend/parse`, {
                                    method: 'POST',
                                    body: JSON.stringify({ text: speechText }),
                                  });
                                  if (res.ok) {
                                    const reqData = await res.json();
                                    if (reqData && reqData.id) {
                                      setEditProductName(reqData.productName || "");
                                      setEditProductQty(reqData.productQty || 1);
                                      setEditTargetPrice(reqData.targetPrice || 0);
                                      setEditLocation(reqData.location || "Bangalore Office");
                                      setEditExpenseCategory(reqData.expenseCategory || "IT Hardware & Laptops");
                                      setEditDepartment(reqData.department || "IT & Infrastructure");
                                      setExtraItems(reqData.lineItems?.slice(1).map((ln: any) => ({
                                        productName: ln.productName,
                                        productQty: ln.productQty,
                                        targetPrice: ln.targetPrice,
                                      })) || []);
                                      setCurrentOdooRequestName(reqData.id);
                                      parsedSuccessfully = true;
                                    }
                                  }
                                } catch (e) {
                                  console.warn(e);
                                }
                                if (!parsedSuccessfully) {
                                  parseSpeechText(speechText);
                                  setCurrentOdooRequestName("New");
                                }
                                setIsParsing(false);
                                setActiveScene(4);
                              }}
                              className="px-5 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1"
                            >
                              <span>Continue</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {/* --- SCENE 4: PARSED REQUISITION FORM --- */}
              {activeScene === 4 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={FileInput}
                    title="Your Request Details"
                    subtitle="Check and edit what the AI understood from your message."
                    right={
                      <span className="hero-ctl px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>98% Parse Confidence</span>
                      </span>
                    }
                  />
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left Form: Editable details */}
                    <div className="md:col-span-2 p-6 rounded-2xl bg-surface border border-borderTheme space-y-4">
                      <div className="flex items-center justify-between border-b border-borderTheme pb-2">
                        <h3 className="font-outfit text-base font-bold text-textPrimary">Extracted Parameters</h3>
                        <span className="text-[11px] text-textFaint">{1 + extraItems.length} line item{extraItems.length ? 's' : ''}</span>
                      </div>

                      {/* Products — multi-line (#9) */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-12 gap-2 text-[10px] text-textFaint font-bold uppercase tracking-wider">
                          <span className="col-span-6">Product</span><span className="col-span-2">Qty</span><span className="col-span-3">Unit ₹</span><span className="col-span-1" />
                        </div>
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <input type="text" value={editProductName} onChange={(e) => setEditProductName(e.target.value)} placeholder="Product description"
                            className="col-span-6 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                          <input type="number" value={editProductQty} onChange={(e) => setEditProductQty(Number(e.target.value))}
                            className="col-span-2 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                          <input type="number" value={editTargetPrice} onChange={(e) => setEditTargetPrice(Number(e.target.value))}
                            className="col-span-3 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                          <span className="col-span-1 text-center text-brand" title="Primary item">★</span>
                        </div>
                        {extraItems.map((it, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                            <input type="text" value={it.productName} onChange={(e) => setExtraItems(prev => prev.map((x, i) => i === idx ? { ...x, productName: e.target.value } : x))} placeholder="Product description"
                              className="col-span-6 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                            <input type="number" value={it.productQty} onChange={(e) => setExtraItems(prev => prev.map((x, i) => i === idx ? { ...x, productQty: Number(e.target.value) } : x))}
                              className="col-span-2 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                            <input type="number" value={it.targetPrice} onChange={(e) => setExtraItems(prev => prev.map((x, i) => i === idx ? { ...x, targetPrice: Number(e.target.value) } : x))}
                              className="col-span-3 bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                            <button onClick={() => setExtraItems(prev => prev.filter((_, i) => i !== idx))} className="col-span-1 flex justify-center text-neg" title="Remove line"><X className="h-4 w-4" /></button>
                          </div>
                        ))}
                        <button onClick={() => setExtraItems(prev => [...prev, { productName: '', productQty: 1, targetPrice: 0 }])}
                          className="text-xs font-semibold text-brand hover:underline flex items-center gap-1"><span className="text-base leading-none">+</span> Add another product</button>
                      </div>

                      {/* Editable meta fields (#3, #8) */}
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Branch</label>
                          <select value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand">
                            {branchOptions.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Department</label>
                          <select value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} className="w-full bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand">
                            {departmentOptions.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Category</label>
                          <select value={editExpenseCategory} onChange={(e) => setEditExpenseCategory(e.target.value)} className="w-full bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand">
                            {(categoryOptions.includes(editExpenseCategory) ? categoryOptions : [editExpenseCategory, ...categoryOptions])
                              .map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Expected Delivery Date</label>
                          <input type="text" value={editDeliveryDate} onChange={(e) => setEditDeliveryDate(e.target.value)} placeholder="e.g. Jul 25, 2026" className="w-full bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand" />
                        </div>
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Expense Type</label>
                          <select value={editExpenseType} onChange={(e) => setEditExpenseType(e.target.value)} className="w-full bg-secondary border border-line2 rounded-lg p-2 text-sm text-primary focus:outline-none focus:border-brand">
                            {expenseTypeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-textFaint font-bold uppercase tracking-wider block mb-1">Estimated Total</label>
                          <span className="w-full bg-secondary/50 border border-borderTheme rounded-lg p-2 text-sm text-brand block font-bold">₹{[{ productQty: editProductQty, targetPrice: editTargetPrice }, ...extraItems].reduce((s, it) => s + it.productQty * it.targetPrice, 0).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end space-x-3">
                        <button onClick={() => setActiveScene(2)} className="px-4 py-2 text-xs text-textSecondary hover:text-primary transition-all font-semibold">Cancel</button>
                        <button onClick={createRequisitionFromForm} className="px-5 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all">Submit for Validation</button>
                      </div>
                    </div>
                    
                    {/* Right Card: Address Resolution Mappings */}
                    <div className="space-y-4">
                      <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-4">
                        <h3 className="font-outfit text-base font-bold text-textPrimary border-b border-borderTheme pb-2">Branch Mapped Addresses</h3>
                        
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] text-textFaint font-bold uppercase tracking-wider block mb-0.5">Input location:</span>
                            <span className="text-xs font-semibold text-textSecondary">"{editLocation}"</span>
                          </div>
                          
                          <div className="pt-2 border-t border-borderTheme">
                            <span className="text-[10px] text-brand font-bold uppercase tracking-wider block">Resolved Bill-To Address</span>
                            <span className="text-xs text-textSecondary font-medium block mt-1 font-semibold">Kuttukaran Corporate HQ, Metro Pillar 32, Kochi, KL - 682025</span>
                            <span className="text-[9px] text-textFaint block mt-0.5">GSTIN: 32AAAAB1234C1Z0</span>
                          </div>
                          
                          <div className="pt-2 border-t border-borderTheme">
                            <span className="text-[10px] text-brand font-bold uppercase tracking-wider block">Resolved Ship-To Address</span>
                            <span className="text-xs text-textSecondary font-medium block mt-1 font-semibold">Kuttukaran Regional Warehouse, IT Park, Bangalore, KA - 560066</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* --- SCENE 9: BUDGET VALIDATION --- */}
              {activeScene === 9 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Landmark}
                    title="Budget Check"
                    subtitle="We check your branch has the funds available — instantly."
                    right={
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Simulate</span>
                        <button
                          onClick={() => { setBudgetBreach(false); setBudgetAction("default"); }}
                          className={`px-3 py-2 rounded-full text-xs font-bold hero-ctl ${!budgetBreach ? 'hero-ctl-on' : ''}`}
                        >
                          Within Limit
                        </button>
                        <button
                          onClick={() => { setBudgetBreach(true); }}
                          className={`px-3 py-2 rounded-full text-xs font-bold hero-ctl ${budgetBreach ? 'hero-ctl-on' : ''}`}
                        >
                          Limit Exceeded
                        </button>
                      </div>
                    }
                  />
                  
                  <div className="grid grid-cols-1 gap-6">
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-6">
                      <h3 className="font-outfit text-base font-bold text-textPrimary border-b border-borderTheme pb-2">{currentRequest.expenseCategory} Budget Allocation</h3>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between text-xs text-textSecondary">
                          <span>Total Allocated Q3 Budget:</span>
                          <span className="font-bold text-textPrimary">₹30,00,000</span>
                        </div>
                        <div className="flex justify-between text-xs text-textSecondary">
                          <span>Committed Spend:</span>
                          <span className="font-bold text-textPrimary">₹12,00,000</span>
                        </div>
                        <div className="flex justify-between text-xs text-textSecondary">
                          <span>Current Request ({currentLines.length} product{currentLines.length > 1 ? 's' : ''} · {linesQty(currentLines)} units):</span>
                          <span className="font-bold text-brand">₹{linesTotal(currentLines).toLocaleString()}</span>
                        </div>

                        <LineItemsTable lines={currentLines} title="Cost breakdown by line" totalLabel="Request Value" />

                        <div className="relative pt-2">
                          <div className="h-4 w-full bg-secondary rounded-full overflow-hidden flex">
                            <div className="h-full bg-raised" style={{ width: '40%' }} />
                            <div className={`h-full ${budgetBreach ? 'bg-neg' : 'bg-brand'}`} style={{ width: budgetBreach ? '70%' : '20%' }} />
                          </div>
                        </div>
                      </div>
                      
                      {!budgetBreach ? (
                        <div className="p-4 bg-pos/20 border border-pos/40 rounded-xl flex items-start space-x-3 text-pos text-xs">
                          <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0 text-pos" />
                          <div>
                            <p className="font-bold">Budget Verification Passed</p>
                            <p className="mt-1 text-textSecondary">
                              {currentRequest.budgetName
                                ? <>Checked against <strong>{currentRequest.budgetName}</strong> — ₹{Math.round(currentRequest.budgetAvailable ?? 0).toLocaleString()} still available.</>
                                : 'Funds are available. Mapped to Cost Center. No pre-approvals required for budget allocation.'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 bg-neg/20 border border-neg/40 rounded-xl flex items-start space-x-3 text-neg text-xs">
                          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-neg animate-pulse" />
                          <div>
                            <p className="font-bold">
                              Budget Limit Exceeded by ₹{Math.round(
                                currentRequest.budgetName
                                  ? linesTotal(currentLines) - (currentRequest.budgetAvailable ?? 0)
                                  : linesTotal(currentLines) + 1200000 - 3000000
                              ).toLocaleString()}
                            </p>
                            <p className="mt-1 text-textSecondary">
                              {currentRequest.budgetName
                                ? <><strong>{currentRequest.budgetName}</strong> has ₹{Math.round(currentRequest.budgetAvailable ?? 0).toLocaleString()} left against a request of ₹{Math.round(linesTotal(currentLines)).toLocaleString()}.</>
                                : 'This requisition exceeds the remaining allocated budget threshold.'}
                            </p>
                          </div>
                        </div>
                      )}
                      
                      <div className="pt-2 flex justify-end space-x-3">
                        <button onClick={() => setActiveScene(4)} className="px-4 py-2 text-xs text-textSecondary font-semibold hover:text-primary">Modify Request</button>
                        {hasContract ? (
                          <button onClick={async () => {
                            // Raise it for real in Odoo; only simulate when that fails.
                            const raised = await createPurchaseOrderInOdoo(selectedRequestId);
                            if (!raised) {
                              setRequests(prev => prev.map(r => {
                                if (r.id === selectedRequestId) {
                                  return {
                                    ...r,
                                    status: "PO Confirmed",
                                    history: [...r.history, { title: "Fast-Track Auto PO Created", date: "Now", desc: "Active Rate Contract bypassed manual sourcing." }]
                                  };
                                }
                                return r;
                              }));
                            }
                            setActiveScene(11);
                          }} className="px-5 py-2 bg-pos hover:bg-pos text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1">
                            <span>Auto-Generate Purchase Order</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        ) : (
                          <button onClick={() => {
                            setRequests(prev => prev.map(r => {
                              if (r.id === selectedRequestId) {
                                return {
                                  ...r,
                                  status: "Pending Approval",
                                  history: [...r.history, { title: "Routed for Manager Approval", date: "Now", desc: "Negotiated contract routed for operational sign-off." }]
                                };
                              }
                              return r;
                            }));
                            setUserRole("Manager");
                            setActiveScene(10);
                          }} className="px-5 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1">
                            <span>Route to Manager Approval</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* --- SCENE 5: RATE CONTRACT CHECK --- */}
              {activeScene === 5 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Search}
                    title="Finding the Best Price"
                    subtitle="We look for existing supplier contracts and agreed rates."
                    right={
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Contract exists?</span>
                        <button
                          onClick={() => setHasContract(true)}
                          className={`px-3.5 py-2 rounded-full text-xs font-bold hero-ctl ${hasContract ? 'hero-ctl-on' : ''}`}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setHasContract(false)}
                          className={`px-3.5 py-2 rounded-full text-xs font-bold hero-ctl ${!hasContract ? 'hero-ctl-on' : ''}`}
                        >
                          No
                        </button>
                      </div>
                    }
                  />
                  
                  <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-6">
                    {hasContract ? (
                      <div className="space-y-6 animate-fadeIn">
                        <div className="p-5 bg-pos/20 border border-pos/40 rounded-2xl flex items-start space-x-4">
                          <div className="h-12 w-12 rounded-xl bg-pos/10 flex items-center justify-center border border-pos/25 text-pos">
                            <ShieldCheck className="h-6 w-6" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="font-outfit font-extrabold text-lg text-pos">
                              {currentRequest.contract ? `Rate Contract ${currentRequest.contract} Mapped` : 'Active Rate Contract Mapped'}
                            </h3>
                            <p className="text-sm text-textSecondary">
                              {currentRequest.contract
                                ? <>Matched with <strong>{currentRequest.contractVendor}</strong>, covering {currentLines.length} requested product{currentLines.length > 1 ? 's' : ''}. Total Allocation: </>
                                : <>Found active agreements covering all {currentLines.length} requested product{currentLines.length > 1 ? 's' : ''}. Total Allocation: </>}
                              <strong>₹{linesTotal(currentLines.map(l => ({ ...l, targetPrice: getContractPrice(l.productName) }))).toLocaleString()}</strong>.
                            </p>
                          </div>
                        </div>

                        <LineItemsTable
                          lines={currentLines.map(l => ({ ...l, targetPrice: getContractPrice(l.productName) }))}
                          title="Contracted rates per line"
                          totalLabel="Contract Value"
                        />

                        {/* Where the approvals have got to. Informational only —
                            the walkthrough is allowed to run ahead of them, so
                            the demo never gets stuck waiting for a signature. */}
                        {!chainSigned(currentRequest) && <ApprovalChain request={currentRequest} compact />}
                        <div className="flex justify-end space-x-3 pt-2">
                          <button onClick={() => {
                            setRequests(prev => prev.map(r => {
                              if (r.id === selectedRequestId) {
                                const priced = reqLines(r).map(l => ({ ...l, targetPrice: getContractPrice(l.productName) }));
                                return {
                                  ...r,
                                  lineItems: priced,
                                  targetPrice: priced[0].targetPrice,
                                  totalCost: linesTotal(priced),
                                  vendor: "Primus Technologies"
                                };
                              }
                              return r;
                            }));
                            setActiveScene(9);
                          }} className="px-5 py-2.5 bg-pos hover:bg-pos text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1">
                            <span>Proceed to Budget Verification</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6 animate-fadeIn">
                        <div className="p-5 bg-gold/25 border border-gold/45 rounded-2xl flex items-start space-x-4">
                          <div className="h-12 w-12 rounded-xl bg-gold/10 flex items-center justify-center border border-gold/25 text-gold">
                            <AlertCircle className="h-6 w-6" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="font-outfit font-extrabold text-lg text-gold">No Active Contract Found</h3>
                            <p className="text-sm text-textSecondary">The product category does not have a pre-negotiated volume contract. Sourcing is required for all {currentLines.length} line{currentLines.length > 1 ? 's' : ''}.</p>
                          </div>
                        </div>

                        <LineItemsTable lines={currentLines} title="Lines to be sourced" totalLabel="Estimated Value" />

                        {/* Where the approvals have got to. Informational only —
                            the walkthrough is allowed to run ahead of them, so
                            the demo never gets stuck waiting for a signature. */}
                        {!chainSigned(currentRequest) && <ApprovalChain request={currentRequest} compact />}
                        <div className="flex justify-end space-x-3 pt-2">
                          <button onClick={() => {
                            setRequests(prev => prev.map(r => {
                              if (r.id === selectedRequestId) {
                                return {
                                  ...r,
                                  status: "Sourcing"
                                };
                              }
                              return r;
                            }));
                            setUserRole("SCM Buyer");
                            setScmTab('requests');
                            setActiveScene(6);
                          }} className="px-5 py-2.5 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1">
                            <span>Launch RFQ Sourcing Portal</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* --- SCENE 6: SCM BUYER PORTAL (RFQ & BIDDING MANAGEMENT) --- */}
              {activeScene === 6 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Briefcase}
                    title="Sourcing Desk"
                    subtitle="All your sourcing work, live quotes and vendor finds in one place."
                    stats={[
                      { label: 'To source', value: String(requests.filter(r => BUYER_QUEUE_STATUSES.includes(r.status)).length) },
                      { label: 'Pipeline', value: `₹${Math.round(requests.filter(r => BUYER_QUEUE_STATUSES.includes(r.status)).reduce((s, r) => s + r.totalCost, 0) / 1000)}K` },
                    ]}
                  />

                  {/* SCM Sourcing Tab Selector */}
                  <div className="flex border-b border-borderTheme">
                    <button 
                      onClick={() => setScmTab('requests')} 
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${scmTab === 'requests' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      Active Contract Requests (CR)
                    </button>
                    <button 
                      onClick={() => setScmTab('bidding')} 
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${scmTab === 'bidding' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      Bidding &amp; Live RFQs
                    </button>
                    <button 
                      onClick={() => setScmTab('discovery')} 
                      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${scmTab === 'discovery' ? 'border-brand text-primary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
                    >
                      AI Vendor Sourcing Discovery
                    </button>
                  </div>

                  {/* SCM Tab 1: Contract Requests Queue */}
                  {scmTab === 'requests' && (() => {
                    const scmList = newestFirst(requests.filter(r => BUYER_QUEUE_STATUSES.includes(r.status) && requestHaystack(r).includes(scmSearch.trim().toLowerCase())));
                    return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-outfit font-extrabold text-xl text-primary">Requests to Source <span className="text-textFaint font-semibold">({scmList.length})</span></h3>
                          <p className="text-xs text-textSecondary">Requests that need vendor quotes.</p>
                        </div>
                        <RequestSearch value={scmSearch} onChange={setScmSearch} placeholder="Search requests…" />
                      </div>

                      {scmList.length === 0 ? (
                        <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                          <Search className="h-8 w-8 mx-auto text-textFaint mb-2" />
                          <p className="text-sm font-semibold text-textPrimary">No requests to source right now</p>
                          <p className="text-xs text-textFaint mt-1">{scmSearch ? 'Try a different keyword.' : 'New sourcing work will appear here.'}</p>
                        </div>
                      ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {scmList.map(req => (
                          <div key={req.id} className="p-6 rounded-2xl bg-surface border border-borderTheme flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-bold text-textFaint">{req.id}</span>
                                <span className="text-xs px-2.5 py-0.5 rounded bg-brand/20 text-brand border border-brand/20 font-bold uppercase">SOURCING FALLBACK</span>
                              </div>
                              <h4 className="font-outfit font-extrabold text-lg text-primary">{req.productQty}x {reqSummary(req)}</h4>
                              <p className="text-xs text-textSecondary">Estimated Value: <strong>{req.totalCost > 0 ? `₹${req.totalCost.toLocaleString()}` : "TBD (Pending Sourcing Bids)"}</strong> | Mapped to: {req.expenseCategory}</p>
                            </div>

                            <div className="flex items-center space-x-3">
                              {/* Sourcing strategies selection */}
                              <select 
                                value={req.selectedSourcingMethod}
                                onChange={(e) => {
                                  const method = e.target.value as 'Negotiation' | 'Multi RFQ' | 'Bidding';
                                  setRequests(prev => prev.map(r => r.id === req.id ? { ...r, selectedSourcingMethod: method } : r));
                                }}
                                className="bg-secondary border border-line2/80 rounded-lg p-2 text-xs text-primary focus:outline-none"
                              >
                                <option value="Multi RFQ">Invite Preferred (Multi-RFQ)</option>
                                <option value="Negotiation">Direct Price Negotiator</option>
                                <option value="Bidding">Live Reverse Auction</option>
                              </select>

                              <button 
                                onClick={() => { setSelectedRequestId(req.id); setScmTab('bidding'); }}
                                className="px-4 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all"
                              >
                                Manage RFQ
                              </button>
                              {(() => {
                                // A live reverse auction: offered once the buyer picks
                                // "Live Reverse Auction" above, and a way back into the
                                // auction room once one is running for this request.
                                const running = auctionForRequest(req.id);
                                if (running) {
                                  return (
                                    <button
                                      onClick={() => { setAuctionOpen(running.id); setActiveScene(19); }}
                                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brand/30 bg-brand/10 text-xs font-bold text-brand"
                                    >
                                      {running.state === 'live' ? <span className="auction-live-dot" /> : <Gavel className="h-3.5 w-3.5" />}
                                      {running.id}
                                    </button>
                                  );
                                }
                                if (req.selectedSourcingMethod !== 'Bidding') return null;
                                return (
                                  <button
                                    onClick={() => { setAuctionLaunchFor(req.id); setActiveScene(19); }}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-md"
                                    style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 60%, #EC4899 100%)' }}
                                  >
                                    <Gavel className="h-3.5 w-3.5" /> Launch Auction
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                    );
                  })()}

                  {/* SCM Tab 2: RFQ Bidding Events (Managing RFQs and bidding) */}
                  {scmTab === 'bidding' && (
                    <div className="space-y-6">
                      {/* The live reverse auction for this request — launched and run
                          from the auction desk. */}
                      {(() => {
                        const running = auctionForRequest(currentRequest.id);
                        if (!running && !['Approved', 'Sourcing'].includes(currentRequest.status)) return null;
                        return (
                          <div className="relative overflow-hidden rounded-2xl p-5 text-white flex flex-col sm:flex-row sm:items-center gap-4 shadow-lg"
                               style={{ background: 'linear-gradient(135deg, #140F2A 0%, #211943 52%, #2A1640 100%)' }}>
                            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 border border-white/15">
                              <Gavel className="h-5 w-5 text-pink-200" />
                            </div>
                            <div className="flex-1">
                              <p className="font-outfit font-extrabold flex items-center gap-2">
                                {running?.state === 'live' && <span className="auction-live-dot" />}
                                {running ? `${running.id} · ${running.state === 'live' ? 'live now' : running.state === 'closed' ? 'waiting for your award' : running.state}` : 'Run this as a live reverse auction'}
                              </p>
                              <p className="text-xs text-white/60">
                                {running ? 'Open the auction room to watch the bids come in and award it.'
                                  : 'Invite vendors and let them bid the price down against the clock — the winner lands on this request.'}
                              </p>
                            </div>
                            <button
                              onClick={() => { if (running) setAuctionOpen(running.id); else setAuctionLaunchFor(currentRequest.id); setActiveScene(19); }}
                              className="rounded-xl bg-white px-4 py-2 text-xs font-black text-[#1b1537] shadow"
                            >
                              {running ? 'Open auction room' : 'Launch auction'}
                            </button>
                          </div>
                        );
                      })()}
                      <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-borderTheme pb-4">
                          <div>
                            <span className="text-xs text-brand font-bold block">{currentRequest.id} Bidding Management</span>
                            <h3 className="font-outfit font-extrabold text-xl text-primary">{currentRequest.productQty}x {reqSummary(currentRequest)}</h3>
                          </div>

                          <div className="mt-2 sm:mt-0 flex items-center space-x-2">
                            <span className="px-2.5 py-1 bg-brand/20 text-brand border border-brand/25 rounded-md text-xs font-bold">
                              Sourcing: {currentRequest.selectedSourcingMethod} Mode
                            </span>
                          </div>
                        </div>

                        {/* Full RFQ scope so vendors bid on every requested line */}
                        <LineItemsTable lines={currentLines} title="RFQ scope" totalLabel="Estimated Value" />

                        {/* Bid submissions table */}
                        <div className="space-y-3">
                          <h4 className="text-xs text-textFaint font-bold uppercase tracking-wider">Active Vendor Bids (Received in real-time)</h4>
                          
                          {currentRequest.vendorBids.length === 0 ? (
                            <div className="p-6 text-center bg-secondary/40 border border-borderTheme rounded-xl text-textSecondary text-xs">
                              No bids received yet. Invite vendors or click "Trigger Bidding" below to populate quotes.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-borderTheme text-textFaint font-bold">
                                    <th className="py-2.5">Supplier Name</th>
                                    <th className="py-2.5">Quote Price</th>
                                    <th className="py-2.5">Warranty SLA</th>
                                    <th className="py-2.5">Lead Time</th>
                                    <th className="py-2.5">Onboard Status</th>
                                  </tr>
                                </thead>
                                <tbody className="text-textSecondary">
                                  {currentRequest.vendorBids.map((bid, idx) => (
                                    <tr key={idx} className="border-b border-borderTheme">
                                      <td className="py-3 font-semibold">{bid.vendorName}</td>
                                      <td className="py-3 font-bold text-primary">₹{bid.price.toLocaleString()}</td>
                                      <td className="py-3 text-textSecondary">{bid.warranty}</td>
                                      <td className="py-3 text-textSecondary">{bid.leadTime}</td>
                                      <td className="py-3">
                                        <span className="px-2 py-0.5 rounded bg-pos/15 text-pos font-bold text-[9px] uppercase border border-pos/20">
                                          Approved Partner
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* Interactive simulation action controls */}
                        <div className="flex justify-between items-center pt-4 border-t border-borderTheme">
                          <button 
                            onClick={() => {
                              // Simulate adding a bid from Primus Tech
                              setRequests(prev => prev.map(r => {
                                if (r.id === selectedRequestId) {
                                  return {
                                    ...r,
                                    vendorBids: [
                                      ...r.vendorBids,
                                      { vendorName: "Primus Technologies", price: r.targetPrice - 4000, leadTime: "5 Days", warranty: "3 Years On-Site", status: "Recommended" }
                                    ]
                                  };
                                }
                                return r;
                              }));
                              alert("Simulated: Vendor 'Primus Technologies' submitted a new quote.");
                            }}
                            className="px-4 py-2 bg-secondary hover:bg-raised text-xs font-semibold rounded-lg text-textPrimary transition-all border border-borderTheme"
                          >
                            Simulate Vendor Bid Submission
                          </button>

                          <div className="flex space-x-3">
                            <button 
                              onClick={() => setActiveScene(7)} 
                              className="px-4 py-2 border border-line2 hover:bg-secondary text-xs font-semibold rounded-lg text-textSecondary"
                            >
                              Open Scorecard Matrix
                            </button>
                            <button 
                              onClick={() => {
                                resetNegotiation();
                                setActiveScene(8);
                              }} 
                              className="px-5 py-2.5 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand"
                            >
                              Launch AI Negotiation
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Mock Vendor Submission Form panel (To show how vendors interact) */}
                      <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-4">
                        <div className="flex items-center space-x-2 text-brand">
                          <Landmark className="h-4.5 w-4.5" />
                          <h4 className="font-outfit font-extrabold text-base text-primary">Vendor Portal Simulation Workspace</h4>
                        </div>
                        <p className="text-xs text-textSecondary">This simulates the external vendor's secure magic link. Entering details submits them.</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2">
                          <div>
                            <label className="text-textFaint block mb-1">Quote price per unit (₹):</label>
                            <input 
                              type="number"
                              value={vendorBidPrice}
                              onChange={(e) => setVendorBidPrice(e.target.value)}
                              className="w-full bg-secondary border border-line2 rounded-lg p-2 text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-textFaint block mb-1">Delivery Lead Time:</label>
                            <input 
                              type="text"
                              value={vendorLeadTime}
                              onChange={(e) => setVendorLeadTime(e.target.value)}
                              className="w-full bg-secondary border border-line2 rounded-lg p-2 text-primary"
                            />
                          </div>
                          <div className="flex items-end">
                            <button 
                              onClick={handleVendorBidSubmit}
                              className="w-full py-2 bg-pos hover:bg-pos text-xs font-bold rounded-lg text-onbrand transition-all"
                            >
                              Submit Vendor Bid
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SCM Tab 3: AI Vendor Sourcing Discovery (Auto creation of draft vendor) */}
                  {scmTab === 'discovery' && (
                    <div className="space-y-6">
                      <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-4">
                        <h3 className="font-outfit font-extrabold text-lg text-primary">AI Sourcing Directory Discovery</h3>
                        <p className="text-xs text-textSecondary">Search external B2B registries to resolve suppliers for non-catalog categories.</p>

                        <form onSubmit={handleSearchVendors} className="flex gap-2 max-w-lg">
                          <input 
                            type="text" 
                            value={searchVendorQuery}
                            onChange={(e) => setSearchVendorQuery(e.target.value)}
                            placeholder="Type product categories (e.g. Server components, desks)..."
                            className="flex-grow bg-secondary border border-line2 rounded-lg px-3 py-2 text-xs text-primary focus:outline-none"
                          />
                          <button type="submit" className="px-4 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand">
                            Search registries
                          </button>
                        </form>
                      </div>

                      {/* Onboard Success Notification banner */}
                      {showDraftOnboardSuccess && (
                        <div className="p-4 bg-pos/20 border border-pos/40 rounded-xl flex items-start space-x-3 text-pos text-xs animate-fadeIn">
                          <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-bold">Draft Partner Auto-Created!</p>
                            <p className="mt-1 text-textSecondary">
                              Successfully registered <strong>{lastOnboardedVendor}</strong> as a draft partner (Record ID: `res.partner.draft_092`). Magic link sent for onboard completion.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* SCM Discovery search result lists */}
                      {searchingVendors ? (
                        <div className="p-8 text-center text-xs text-textSecondary">Searching B2B databases...</div>
                      ) : discoveredVendors.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {discoveredVendors.map((vendor, idx) => (
                            <div key={idx} className="p-5 rounded-2xl bg-surface border border-borderTheme flex flex-col justify-between h-56">
                              <div>
                                <span className="px-2 py-0.5 bg-secondary border border-line2/60 rounded text-[9px] font-bold text-textSecondary uppercase">
                                  External Discovery Match
                                </span>
                                <h4 className="font-outfit font-extrabold text-lg text-primary mt-2">{vendor.name}</h4>
                                <p className="text-xs text-textSecondary mt-1">{vendor.category}</p>

                                <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-borderTheme text-xs text-textSecondary">
                                  <span>Trust score: <strong>{vendor.rating}/100</strong></span>
                                  <span>AI Index: <strong>{vendor.score}%</strong></span>
                                </div>
                              </div>

                              <div className="flex justify-between items-center pt-2">
                                <span className="text-[10px] text-textFaint">Not in the vendor master</span>
                                <button 
                                  onClick={() => handleAutoOnboard(vendor.name)}
                                  className="px-3.5 py-1.5 bg-pos hover:bg-pos text-xs font-bold rounded-lg text-onbrand"
                                >
                                  Auto-Create Draft Vendor
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-surface/40 border border-borderTheme rounded-xl text-textSecondary text-xs">
                          Search above to simulate sourcing new suppliers from B2B catalogs.
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
              
              {/* --- SCENE 7: RFQ COMPARISON MATRIX --- */}
              {activeScene === 7 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Award}
                    title="Compare Vendor Quotes"
                    subtitle="See every vendor's price and terms side by side."
                  />
                  
                  <div className="p-6 rounded-2xl bg-surface border border-borderTheme overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-borderTheme text-xs text-textSecondary uppercase font-bold tracking-wider">
                          <th className="py-3 px-4">Evaluation Criteria</th>
                          <th className="py-3 px-4 bg-brand/20 text-brand">Primus Technologies</th>
                          <th className="py-3 px-4">Apex Systems</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs text-textSecondary">
                        <tr className="border-b border-borderTheme/50">
                          <td className="py-3 px-4 font-semibold">Unit Quote Price</td>
                          <td className="py-3 px-4 bg-brand/15 font-bold text-primary">₹{getNegotiationBaselinePrice(currentRequest.productName).toLocaleString()}</td>
                          <td className="py-3 px-4">₹{(getNegotiationBaselinePrice(currentRequest.productName) + 3000).toLocaleString()}</td>
                        </tr>
                        <tr className="border-b border-borderTheme/50">
                          <td className="py-3 px-4 font-semibold">Warranty Terms</td>
                          <td className="py-3 px-4 bg-brand/15">3 Years On-Site Support</td>
                          <td className="py-3 px-4">1 Year Carry-In Warranty</td>
                        </tr>
                        <tr className="border-b border-borderTheme/50">
                          <td className="py-3 px-4 font-semibold">Delivery Timeframe</td>
                          <td className="py-3 px-4 bg-brand/15 font-bold text-pos">5 Business Days</td>
                          <td className="py-3 px-4">10 Business Days</td>
                        </tr>
                        <tr className="border-b border-borderTheme/50">
                          <td className="py-3 px-4 font-semibold">Payment Milestones</td>
                          <td className="py-3 px-4 bg-brand/15">Net-30 Audited Terms</td>
                          <td className="py-3 px-4">Net-15 Invoice Terms</td>
                        </tr>
                        <tr className="border-b border-borderTheme/50">
                          <td className="py-3 px-4 font-semibold">Risk &amp; Health Score</td>
                          <td className="py-3 px-4 bg-brand/15">Low Risk (Score: 96)</td>
                          <td className="py-3 px-4 text-gold font-medium">Medium Risk (Score: 88)</td>
                        </tr>
                        <tr>
                          <td className="py-3 px-4 font-semibold">AI Recommendation</td>
                          <td className="py-3 px-4 bg-brand/20">
                            <span className="px-2 py-0.5 rounded bg-pos/20 text-pos font-bold text-[10px]">RECOMMENDED FIT</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-textFaint font-medium">Not Recommended</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    
                    <div className="pt-6 flex justify-end space-x-3">
                      <button onClick={() => { setUserRole("SCM Buyer"); setScmTab('bidding'); setActiveScene(6); }} className="px-4 py-2 text-xs text-textSecondary font-semibold hover:text-primary">Back to Sourcing</button>
                      <button onClick={() => setActiveScene(8)} className="px-5 py-2.5 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1">
                        <span>Trigger AI Negotiation</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {/* --- SCENE 8: AI NEGOTIATION LOUNGE --- */}
              {activeScene === 8 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Sparkles}
                    title="AI Price Negotiation"
                    subtitle="Watch the AI negotiate the price and terms with the supplier."
                    right={
                      <>
                        <span className="hero-ctl px-3.5 py-2 rounded-full text-xs font-bold">
                          Savings: ₹{((getNegotiationBaselinePrice(currentRequest.productName) - currentOfferPrice) * currentRequest.productQty).toLocaleString()} (₹{(getNegotiationBaselinePrice(currentRequest.productName) - currentOfferPrice).toLocaleString()}/unit)
                        </span>
                        <button
                          onClick={resetNegotiation}
                          className="hero-ctl p-2.5 rounded-full"
                          title="Restart Negotiation"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </>
                    }
                  />
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 flex flex-col h-[400px] rounded-2xl bg-surface border border-borderTheme overflow-hidden">
                      <div className="p-4 bg-secondary border-b border-borderTheme flex items-center justify-between">
                        <span className="text-xs text-textPrimary font-bold uppercase tracking-wider">Live Agent Log</span>
                        <span className="h-2 w-2 rounded-full bg-pos animate-ping" />
                      </div>
                      
                      <div className="flex-grow p-4 overflow-y-auto space-y-4">
                        {chatLog.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                            <div className="h-12 w-12 rounded-full bg-brand/10 flex items-center justify-center text-brand border border-brand/20">
                              <Sparkles className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-textSecondary">Negotiation Lounge Ready</p>
                              <p className="text-xs text-textFaint mt-1">Click the button below to simulate the AI autonomous pricing discussion.</p>
                            </div>
                          </div>
                        ) : (
                          chatLog.map((m, idx) => (
                            <div key={idx} className={`flex ${m.sender === 'ai' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
                              <div className={`max-w-md p-3.5 rounded-2xl text-xs space-y-1 ${m.sender === 'ai' ? 'bg-brand text-onbrand rounded-tr-none' : 'bg-secondary text-textPrimary rounded-tl-none border border-line2/60'}`}>
                                <div className="flex items-center justify-between text-[9px] opacity-75 font-bold uppercase tracking-wider mb-1">
                                  <span>{m.sender === 'ai' ? '🤖 SmartSpend AI' : '👤 Primus Bot'}</span>
                                  <span>{m.timestamp}</span>
                                </div>
                                <p className="leading-relaxed">{m.text}</p>
                              </div>
                            </div>
                          ))
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      
                      <div className="p-3 bg-secondary/60 border-t border-borderTheme flex justify-between items-center">
                        <span className="text-[10px] text-textFaint">Autonomous API negotiation active</span>
                        {!negotiationComplete ? (
                          <button 
                            onClick={triggerNextNegotiationStep}
                            className="px-4 py-2 bg-brand hover:bg-brand text-xs font-bold rounded-lg text-onbrand transition-all flex items-center space-x-1"
                          >
                            <span>{negotiationStep === 0 ? 'Start Agent Session' : 'Continue Negotiation'}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-xs text-pos font-bold flex items-center space-x-1 animate-fadeIn">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Agreement Locked &amp; Confirmed</span>
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl bg-surface border border-borderTheme space-y-4">
                        <h3 className="font-outfit text-base font-bold text-textPrimary border-b border-borderTheme pb-2">Deal Tracker</h3>
                        
                        <div className="space-y-3 text-xs">
                          <div className="flex justify-between">
                            <span className="text-textFaint">Original Bid:</span>
                            <span className="font-semibold text-textSecondary">₹{getNegotiationBaselinePrice(currentRequest.productName).toLocaleString()} / unit</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textFaint">Negotiated Rate:</span>
                            <span className="font-bold text-pos">₹{currentOfferPrice.toLocaleString()} / unit</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textFaint">Savings ({currentRequest.productQty} units):</span>
                            <span className="font-bold text-pos">₹{((getNegotiationBaselinePrice(currentRequest.productName) - currentOfferPrice) * currentRequest.productQty).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      
                      {negotiationComplete && (
                        <button 
                          onClick={() => {
                            setRequests(prev => prev.map(r => {
                              if (r.id !== selectedRequestId) return r;
                              // Apply the negotiated discount % across every line of the requisition.
                              const discount = currentOfferPrice / getNegotiationBaselinePrice(r.productName);
                              const priced = reqLines(r).map((l, i) => ({
                                ...l,
                                targetPrice: i === 0 ? currentOfferPrice : Math.round(getNegotiationBaselinePrice(l.productName) * discount / 50) * 50,
                              }));
                              return { ...r, lineItems: priced, targetPrice: currentOfferPrice, totalCost: linesTotal(priced), vendor: "Primus Technologies" };
                            }));
                            setActiveScene(9);
                          }}
                          className="w-full py-3 bg-brand hover:bg-brand text-xs font-bold rounded-xl text-onbrand transition-all shadow-lg flex items-center justify-center space-x-2"
                        >
                          <span>Proceed to Budget Verification</span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {/* --- SCENE 10: MANAGER APPROVAL INBOX --- */}
              {activeScene === 10 && (
                <div className="max-w-6xl mx-auto py-8 animate-fadeIn">
                  <SceneHeader
                    icon={ShieldCheck}
                    title="Approvals"
                    subtitle="Everything you need to approve a request — no complex menus."
                    className="mb-5"
                    stats={[
                      { label: 'Awaiting you', value: String(requests.filter(r => r.status === 'Pending Approval').length) },
                      { label: 'AI savings', value: `₹${Math.round(requests.reduce((s, r) => s + r.savings, 0) / 1000)}K` },
                    ]}
                  />

                  {/* Status-wise approval counts (#7) — gradient spotlight tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-5">
                    {(['Pending Approval', 'Approved', 'Sourcing', 'PO Confirmed', 'Needs Clarification', 'Rejected']).map((st, i) => {
                      const n = requests.filter(r => r.status === st).length;
                      const meta = STATUS_META[st];
                      const share = requests.length ? (n / requests.length) * 100 : 0;
                      return (
                        <StatTile
                          key={st}
                          icon={meta.icon}
                          tint={meta.rgb}
                          value={n}
                          label={meta.short}
                          meter={n === 0 ? 0 : Math.max(share, 6)}
                          delay={i * 55}
                        />
                      );
                    })}
                  </div>

                  {/* Consolidated snapshot (#4) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {(() => {
                      const pending = requests.filter(r => MANAGER_QUEUE_STATUSES.includes(r.status));
                      const value = pending.reduce((s, r) => s + r.totalCost, 0);
                      const saved = pending.reduce((s, r) => s + r.savings, 0);
                      const largest = pending.reduce((m, r) => Math.max(m, r.totalCost), 0);
                      const avg = pending.length ? Math.round(value / pending.length) : 0;
                      return (
                        <div className="p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm flex flex-col">
                          <span className="text-[11px] text-textFaint font-bold uppercase tracking-wider">Awaiting your approval</span>
                          <p className="text-3xl font-extrabold text-textPrimary mt-1.5 font-outfit tabular-nums leading-none">
                            ₹{value.toLocaleString()}
                          </p>
                          <div className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-accent-savings/12 px-2.5 py-1">
                            <TrendingUp className="h-3.5 w-3.5 text-accent-savings" />
                            <span className="text-[11px] font-bold text-accent-savings tabular-nums">
                              ₹{saved.toLocaleString()} AI savings on the table
                            </span>
                          </div>

                          {/* Fills the card with the numbers a manager actually decides on */}
                          <div className="mt-auto pt-5 grid grid-cols-3 gap-2 border-t border-borderTheme/70">
                            {[
                              { label: 'Requests', value: String(pending.length) },
                              { label: 'Largest', value: `₹${Math.round(largest / 1000)}K` },
                              { label: 'Avg ticket', value: `₹${Math.round(avg / 1000)}K` },
                            ].map(m => (
                              <div key={m.label}>
                                <p className="text-base font-extrabold text-textPrimary font-outfit tabular-nums leading-none">{m.value}</p>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint mt-1">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="md:col-span-2 p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <span className="text-[11px] text-textFaint font-bold uppercase tracking-wider">Live request value by department (₹K)</span>
                      <div className="mt-3">
                        {(() => {
                          const agg = requests.reduce((a, r) => { a[r.department] = (a[r.department] || 0) + r.totalCost; return a; }, {} as Record<string, number>);
                          const data = Object.entries(agg).map(([label, value]) => ({ label, value: Math.round(value / 1000) }));
                          return <BarList data={data} color="#6356A8" prefix="₹" suffix="K" />;
                        })()}
                      </div>
                    </div>
                  </div>
                  
                  {(() => {
                    // Newest first: the request that was just submitted is the
                    // one the approver came here to find.
                    const pendingAll = newestFirst(requests.filter(r => MANAGER_QUEUE_STATUSES.includes(r.status)));
                    const mgrList = pendingAll.filter(r => requestHaystack(r).includes(mgrSearch.trim().toLowerCase()));
                    if (pendingAll.length === 0) return (
                      <div className="p-8 text-center bg-surface border border-borderTheme rounded-2xl text-textSecondary shadow-sm">
                        <CheckCircle2 className="h-8 w-8 mx-auto text-accent-savings mb-2" />
                        <p className="text-sm font-bold text-textPrimary font-outfit">All caught up!</p>
                        <p className="text-xs mt-1 text-textSecondary">Nothing needs your approval right now.</p>
                      </div>
                    );
                    return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-outfit font-extrabold text-xl text-primary">Requests to Approve <span className="text-textFaint font-semibold">({mgrList.length})</span></h3>
                        <RequestSearch value={mgrSearch} onChange={setMgrSearch} placeholder="Search requests…" />
                      </div>
                      {mgrList.length === 0 ? (
                        <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                          <Search className="h-8 w-8 mx-auto text-textFaint mb-2" />
                          <p className="text-sm font-semibold text-textPrimary">No requests match your search</p>
                          <p className="text-xs text-textFaint mt-1">Try a different keyword.</p>
                        </div>
                      ) : (
                      <div className="space-y-6">
                      {mgrList.map(req => (
                        <div
                          key={req.id}
                          id={`req-${req.id}`}
                          className={`p-6 rounded-2xl bg-surface shadow-sm space-y-6 transition-all ${
                            req.id === focusRequestId
                              ? 'border-2 border-brand ring-4 ring-brand/15'
                              : 'border border-borderTheme'
                          }`}
                        >
                          <div className="flex items-center justify-between border-b border-borderTheme pb-4">
                            <div className="flex items-center space-x-3">
                              <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-textSecondary font-bold text-sm">AV</div>
                              <div>
                                <p className="text-xs text-textSecondary font-semibold uppercase">Requisition Initiator:</p>
                                <p className="text-sm font-bold text-textPrimary">Anjitha V (IT Ops Specialist)</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Flags the one that was just submitted, so an
                                  approver arriving from the reminder knows which
                                  of the pending requests they came for. */}
                              {req.id === lastSubmittedId && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30 animate-pulse">
                                  Just submitted
                                </span>
                              )}
                              <span className="text-xs text-textSecondary font-bold">{req.id}</span>
                            </div>
                          </div>
                          
                          <div className="space-y-4">
                            <h3 className="font-outfit font-extrabold text-textPrimary text-lg">{req.productQty}x {reqSummary(req)}</h3>

                            <LineItemsTable lines={reqLines(req)} title="Products requested" totalLabel="Total cost" />

                            {/* Who else has to sign, and who it is waiting on.
                                Without this an approver cannot tell whether
                                their signature releases the request or merely
                                passes it to the next level. */}
                            <ApprovalChain request={req} />

                            <div className="grid grid-cols-2 gap-4 text-xs font-outfit">
                              <div>
                                <span className="text-textSecondary block">Total cost:</span>
                                <span className="font-bold text-textPrimary">₹{req.totalCost.toLocaleString()}</span>
                              </div>
                              <div>
                                <span className="text-accent-savings block">Negotiated Savings:</span>
                                <span className="font-bold text-accent-savings">₹{req.savings.toLocaleString()} Saved</span>
                              </div>
                              <div>
                                <span className="text-textSecondary block">Budget Mapped:</span>
                                <span className="font-bold text-textPrimary">{req.expenseCategory}</span>
                              </div>
                              <div>
                                <span className="text-textSecondary block">Vendor Assigned:</span>
                                <span className="font-bold text-textPrimary">{req.vendor}</span>
                              </div>
                              <div>
                                <span className="text-textSecondary block">Branch · Department:</span>
                                <span className="font-bold text-textPrimary">{req.location} · {req.department}</span>
                              </div>
                              <div>
                                <span className="text-textSecondary block">Expected Delivery:</span>
                                <span className="font-bold text-textPrimary">{req.deliveryDate || '—'}</span>
                              </div>
                            </div>

                            {/* Attachments viewer (#11) */}
                            {req.attachments.length > 0 && (
                              <details className="text-xs">
                                <summary className="cursor-pointer list-none flex items-center gap-1.5 text-textSecondary hover:text-brand font-semibold w-fit">
                                  <Paperclip className="h-3.5 w-3.5" /> {req.attachments.length} attachment{req.attachments.length > 1 ? 's' : ''}
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </summary>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {req.attachments.map((f, ai) => (
                                    <a key={ai} href="#" onClick={(e) => e.preventDefault()} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-borderTheme text-[11px] text-textPrimary hover:border-brand transition-all">
                                      <FileText className="h-3.5 w-3.5 text-brand" /> {f}
                                    </a>
                                  ))}
                                </div>
                              </details>
                            )}

                            {/* Manager clarification comments history */}
                            {req.clarificationComments.length > 0 && (
                              <div className="p-4 bg-secondary rounded-xl space-y-2 border border-borderTheme text-xs">
                                <span className="font-bold text-textSecondary block border-b border-borderTheme pb-1">Clarification Thread</span>
                                {req.clarificationComments.map((c, cidx) => (
                                  <p key={cidx} className="mt-1 text-[11px] leading-relaxed">
                                    <strong className={c.role === 'manager' ? 'text-accent-approvals' : 'text-accent-budget'}>
                                      {c.role === 'manager' ? 'Manager: ' : 'Anjitha: '}
                                    </strong>
                                    <span className="text-textPrimary">"{c.text}"</span>
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons group (Approve, Reject, Request Info) */}
                          <div className="flex flex-wrap justify-end gap-2 border-t border-borderTheme pt-4">
                            <button 
                              onClick={() => {
                                handleManagerReject(req.id);
                              }}
                              className="px-4 py-2 border border-borderTheme hover:bg-accent-alerts/10 hover:border-accent-alerts text-xs font-semibold rounded-lg text-textSecondary hover:text-accent-alerts transition-all"
                            >
                              Reject
                            </button>
                            
                            {/* Request Info button triggers dialog */}
                            <button 
                              onClick={() => {
                                setSelectedRequestId(req.id);
                                setShowManagerQueryBox(true);
                              }}
                              className="px-4 py-2 border border-borderTheme hover:bg-accent-approvals/10 hover:border-accent-approvals text-xs font-semibold rounded-lg text-textSecondary hover:text-accent-approvals transition-all"
                            >
                              Request Info
                            </button>

                            <button 
                              onClick={() => {
                                setSelectedRequestId(req.id);
                                setShowManagerQueryBox(false);
                                setShowManagerApproveBox(true);
                              }}
                              className="px-5 py-2.5 bg-accent-savings hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                            >
                              <Check className="h-4.5 w-4.5" />
                              {/* Name the level being signed. On a multi-step
                                  chain "Approve Request" overstates what the
                                  click does — it passes the request on, it does
                                  not release it. */}
                              <span>
                                {(req.approvalTotal ?? 0) > 1
                                  ? `Approve · Level ${(req.approvalDone ?? 0) + 1} of ${req.approvalTotal}`
                                  : 'Approve Request'}
                              </span>
                            </button>
                          </div>

                          {/* Approval note — optional, so the button below approves either way */}
                          {showManagerApproveBox && selectedRequestId === req.id && (
                            <div className="p-4 bg-secondary rounded-xl border border-accent-savings/20 space-y-3 text-xs animate-fadeIn">
                              <label className="font-bold text-textPrimary block">Approval note (optional):</label>
                              <input 
                                type="text"
                                value={managerApprovalNote}
                                onChange={(e) => setManagerApprovalNote(e.target.value)}
                                placeholder="e.g. Approved against the Q3 budget — order against the Primus rate card."
                                className="w-full bg-surface border border-borderTheme rounded-lg p-2.5 text-textPrimary focus:outline-none focus:border-textPrimary"
                              />
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={() => { setShowManagerApproveBox(false); setManagerApprovalNote(""); }}
                                  className="px-3 py-1.5 text-textSecondary hover:text-textPrimary transition-all"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleManagerApprove(req.id, managerApprovalNote)}
                                  className="px-4 py-1.5 bg-accent-savings text-surface font-bold rounded-lg hover:opacity-90 transition-all"
                                >
                                  Confirm Approval
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Request Info Dialogue Card */}
                          {showManagerQueryBox && selectedRequestId === req.id && (
                            <div className="p-4 bg-secondary rounded-xl border border-accent-approvals/20 space-y-3 text-xs animate-fadeIn">
                              <label className="font-bold text-textPrimary block">Ask Initiator for clarification:</label>
                              <input 
                                type="text"
                                value={managerQueryText}
                                onChange={(e) => setManagerQueryText(e.target.value)}
                                placeholder="e.g. Please clarify unit requirements and pricing details..."
                                className="w-full bg-surface border border-borderTheme rounded-lg p-2.5 text-textPrimary focus:outline-none focus:border-textPrimary"
                              />
                              <div className="flex justify-end space-x-2">
                                <button onClick={() => setShowManagerQueryBox(false)} className="px-3 py-1.5 text-textSecondary hover:text-textPrimary transition-all">Cancel</button>
                                <button 
                                  onClick={() => handleRequestInfoSubmit(req.id)} 
                                  className="px-4 py-1.5 bg-accent-approvals hover:opacity-90 text-surface font-bold rounded transition-all shadow-sm"
                                >
                                  Send Request
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      </div>
                      )}
                    </div>
                    );
                  })()}
                  {/* All requests — dense tile grid (#1) */}
                  <div className="mt-8">
                    <h3 className="font-outfit font-bold text-textPrimary mb-3">All Requests <span className="text-textFaint font-medium">({requests.length})</span></h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                      {requests.map((r, i) => {
                        const meta = STATUS_META[r.status];
                        const Icon = meta?.icon ?? FileText;
                        const stage = statusStage(r.status);
                        return (
                          <div
                            key={r.id}
                            className="req-tile p-4 pl-5 animate-fadeIn"
                            style={{ '--tint': statusRgb(r.status), animationDelay: `${i * 40}ms` } as React.CSSProperties}
                          >
                            <div className="relative flex items-center justify-between">
                              <span className="text-[11px] font-bold text-textFaint tabular-nums tracking-wide">{r.id}</span>
                              <span
                                className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full"
                                style={{ color: statusColor(r.status), background: `rgb(${statusRgb(r.status)} / 0.12)` }}
                              >
                                <Icon className="h-3 w-3" />
                                {meta?.short ?? r.status}
                              </span>
                            </div>

                            <p className="relative text-sm font-bold text-textPrimary mt-2 truncate">
                              {r.productQty}× {reqSummary(r)}
                            </p>

                            <div className="relative flex items-end justify-between mt-2.5">
                              <span className="text-[11px] text-textFaint truncate pr-2 leading-snug">
                                {r.location.replace(' Office', '').replace(' Head', '')} · {r.department.split(' ')[0]}
                              </span>
                              <span className="text-base font-extrabold text-textPrimary tabular-nums leading-none shrink-0">
                                ₹{r.totalCost.toLocaleString()}
                              </span>
                            </div>

                            {/* Compact lifecycle tracker — where this request sits today */}
                            <div className="relative mt-3 pt-3 border-t border-borderTheme/70">
                              <div className="flex items-center gap-1">
                                {STAGE_LABELS.map((label, s) => (
                                  <div
                                    key={label}
                                    title={label}
                                    className="h-1.5 flex-1 rounded-full transition-colors duration-300"
                                    style={{
                                      background: s <= stage
                                        ? `rgb(${statusRgb(r.status)})`
                                        : 'rgb(var(--border-color))',
                                    }}
                                  />
                                ))}
                              </div>
                              <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint mt-1.5">
                                {/* Terminal / blocked states have no meaningful stage — name the state itself */}
                                {r.status === 'Rejected' || r.status === 'Needs Clarification'
                                  ? meta.short
                                  : STAGE_LABELS[stage]}
                                {r.savings > 0 && (
                                  <span className="text-accent-savings ml-1.5 normal-case tracking-normal">
                                    · ₹{r.savings.toLocaleString()} saved
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* --- SCENE 11: REQUEST TRACKING TIMELINE --- */}
              {activeScene === 11 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={History}
                    title="Track Your Request"
                    subtitle="A simple, order-tracking style view of where your request is."
                  />
                  
                  <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-8 shadow-sm">
                    {/* Where this request actually stands, said plainly */}
                    {(() => {
                      const plain = plainStatus(currentRequest);
                      return (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary border border-borderTheme">
                          <div className="mt-0.5 p-1.5 rounded-lg" style={{ background: `rgb(${statusRgb(currentRequest.status)} / 0.14)` }}>
                            {React.createElement(STATUS_META[currentRequest.status]?.icon ?? FileText, {
                              className: 'h-4 w-4',
                              style: { color: statusColor(currentRequest.status) },
                            })}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-textPrimary font-outfit">{plain.line}</p>
                            <p className="text-[11px] text-textSecondary mt-0.5">
                              Currently with <strong>{plain.waitingOn}</strong> · {currentRequest.id}
                              {currentRequest.budgetName ? ` · budget ${currentRequest.budgetName}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* The signatures this request needs, and where it has got
                        to. Shown to the requester too: "waiting on the Finance
                        CapEx Head" is the answer to why nothing has moved. */}
                    <ApprovalChain request={currentRequest} />

                    {/* 5-Step Progress Tracker — the first three come from the
                        request's real status, the last two from the ERP steps below */}
                    {(() => {
                      const approved = ['Approved', 'Sourcing', 'PO Confirmed', 'Paid'].includes(currentRequest.status);
                      const sourced = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'].includes(currentRequest.status);
                      const ordered = !!currentRequest.purchaseOrders?.length;
                      const done = [true, sourced, approved, ordered && poApprovedByHead, ordered && poAcknowledgedByVendor];
                      const reached = done.lastIndexOf(true);
                      return (
                    <div className="relative flex justify-between items-center max-w-3xl mx-auto py-4">
                      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-borderTheme z-0" />
                      <div 
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-accent-savings z-0 transition-all duration-500" 
                        style={{ width: `${(Math.max(reached, 0) / (done.length - 1)) * 100}%` }} 
                      />
                      
                      {['Submitted', 'Sourcing', 'PR Approved'].map((label, i) => (
                        <div key={label} className="flex flex-col items-center z-10 text-center space-y-2">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${done[i] ? 'bg-accent-savings text-surface' : 'bg-surface border border-borderTheme text-textSecondary'}`}>
                            {done[i] ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                          </div>
                          <span className="text-[10px] font-bold text-textPrimary font-outfit">{label}</span>
                        </div>
                      ))}
                      
                      <div className="flex flex-col items-center z-10 text-center space-y-2">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${poApprovedByHead ? 'bg-accent-savings text-surface' : 'bg-surface border border-borderTheme text-textSecondary'}`}>
                          {poApprovedByHead ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </div>
                        <span className="text-[10px] font-bold text-textPrimary font-outfit">PO Approved</span>
                      </div>
                      
                      <div className="flex flex-col items-center z-10 text-center space-y-2">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${poAcknowledgedByVendor ? 'bg-accent-savings text-surface' : 'bg-surface border border-borderTheme text-textSecondary'}`}>
                          {poAcknowledgedByVendor ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </div>
                        <span className="text-[10px] font-bold text-textPrimary font-outfit">Acknowledged</span>
                      </div>
                    </div>
                      );
                    })()}

                    {/* Interactive workflow cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-borderTheme font-outfit">
                      {/* Left: PO Details card */}
                      <div className="p-5 bg-secondary rounded-xl border border-borderTheme space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-accent-budget uppercase tracking-wider">Purchase Order Status</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            poAcknowledgedByVendor
                              ? 'bg-accent-savings/15 text-accent-savings border-accent-savings/20'
                              : poApprovedByHead
                              ? 'bg-accent-budget/15 text-accent-budget border-accent-budget/20'
                              : 'bg-accent-approvals/15 text-accent-approvals border-accent-approvals/20'
                          }`}>
                            {poAcknowledgedByVendor
                              ? 'PO Confirmed (Acknowledged)'
                              : poApprovedByHead
                              ? 'Pending Vendor Ack'
                              : 'Pending Purchase Head Approval'}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-textSecondary">PO Reference:</span>
                            <span className="font-semibold text-textPrimary font-mono">
                              {currentRequest.purchaseOrders?.length
                                ? currentRequest.purchaseOrders.join(', ')
                                : 'Not raised yet'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Vendor:</span>
                            <span className="font-semibold text-textPrimary">{currentRequest.vendor || "Apex Systems"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Buying company:</span>
                            <span className="font-semibold text-textPrimary">{companyForBranch(currentRequest.location).short}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Company GSTIN:</span>
                            <span className="font-semibold text-textPrimary font-mono">{companyForBranch(currentRequest.location).gstin}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Total value:</span>
                            <span className="font-bold text-textPrimary">₹{currentRequest.totalCost.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Items:</span>
                            <span className="font-semibold text-textPrimary">{currentLines.length} product{currentLines.length > 1 ? 's' : ''} · {linesQty(currentLines)} units</span>
                          </div>
                        </div>

                        <LineItemsTable lines={currentLines} title="PO lines" totalLabel="PO Value" />
                      </div>

                      {/* Right: Operational Actions card */}
                      <div className="p-5 bg-secondary rounded-xl border border-borderTheme space-y-4">
                        <span className="text-xs font-bold text-textSecondary uppercase tracking-wider block">Action Control Room</span>
                        
                        <div className="space-y-4">
                          {/* Step 1: Raise the order in ERP */}
                          <div className="flex items-start space-x-3 text-xs">
                            <div className={`mt-0.5 p-1 rounded-full ${currentRequest.purchaseOrders?.length ? 'bg-accent-savings/10 text-accent-savings' : 'bg-accent-approvals/10 text-accent-approvals'}`}>
                              <Package className="h-4.5 w-4.5" />
                            </div>
                            <div className="flex-grow space-y-1">
                              <p className="font-bold text-textPrimary">1. Generate Purchase Order</p>
                              <p className="text-[11px] text-textSecondary leading-relaxed">Creates the purchase order from the approved request — contracted lines are priced at their rate-card value.</p>
                              {!currentRequest.purchaseOrders?.length ? (
                                // Odoo refuses this to anyone outside the buyer
                                // group (403), so offering the button to a
                                // requester only produced a misleading error.
                                canRaisePurchaseOrder ? (
                                  <>
                                    <button
                                      onClick={async () => {
                                        setPoBusy(true);
                                        setPoError("");
                                        const raised = await createPurchaseOrderInOdoo(currentRequest.id);
                                        if (!raised) setPoError("Could not raise the purchase order — check that the request is approved and has a vendor.");
                                        setPoBusy(false);
                                      }}
                                      disabled={poBusy}
                                      className="mt-2 px-3 py-1.5 bg-brand hover:opacity-90 disabled:opacity-50 text-[10px] font-bold text-onbrand rounded shadow-sm transition-all"
                                    >
                                      {poBusy ? 'Generating…' : 'Generate Purchase Order'}
                                    </button>
                                    {poError && <p className="text-[10px] text-neg font-semibold mt-1">{poError}</p>}
                                  </>
                                ) : (
                                  <p className="text-[10px] text-textSecondary/60 font-semibold mt-1 italic">
                                    Locked: only the SCM Buyer raises the purchase order. Sign in as buyer@smartspend.demo.
                                  </p>
                                )
                              ) : (
                                <p className="text-[10px] text-accent-savings font-semibold mt-1 font-mono">✓ {currentRequest.purchaseOrders.join(', ')} created</p>
                              )}
                            </div>
                          </div>

                          {/* Step 2: Head Approval */}
                          <div className="flex items-start space-x-3 text-xs border-t border-borderTheme/50 pt-3">
                            <div className={`mt-0.5 p-1 rounded-full ${poApprovedByHead ? 'bg-accent-savings/10 text-accent-savings' : 'bg-accent-approvals/10 text-accent-approvals'}`}>
                              <CheckCircle2 className="h-4.5 w-4.5" />
                            </div>
                            <div className="flex-grow space-y-1">
                              <p className="font-bold text-textPrimary">2. Purchase Head / User Approval</p>
                              <p className="text-[11px] text-textSecondary leading-relaxed">Required to approve standard financial release terms before sending the PO document to the vendor.</p>
                              {poApprovedByHead ? (
                                <p className="text-[10px] text-accent-savings font-semibold mt-1">✓ Approved and released to vendor</p>
                              ) : !currentRequest.purchaseOrders?.length ? (
                                /* There is nothing to release yet. Offering this
                                   before step 1 let a manager "approve" a PO that
                                   did not exist, and the flow then had nowhere to
                                   go. The steps run in order. */
                                <p className="text-[10px] text-textSecondary/60 font-semibold mt-1 italic">
                                  Locked: the SCM Buyer has to raise the purchase order first.
                                </p>
                              ) : isPurchaseHead ? (
                                /* Odoo writes the release and the timeline
                                   entry, then echoes the request back — the
                                   flag and the history come from that answer,
                                   so they survive a reload and belong to this
                                   request alone. */
                                <button
                                  onClick={async () => {
                                    setPoStepBusy('release');
                                    await recordPurchaseOrderStep(currentRequest.id, 'release');
                                    setPoStepBusy('');
                                  }}
                                  disabled={poStepBusy === 'release'}
                                  className="mt-2 px-3 py-1.5 bg-accent-budget hover:opacity-90 disabled:opacity-50 text-[10px] font-bold text-surface rounded shadow-sm transition-all"
                                >
                                  {poStepBusy === 'release' ? 'Releasing…' : 'Approve & Release PO'}
                                </button>
                              ) : (
                                /* Name the action, not just the rule. "Sign in
                                   as Manager" read as sign out and back in,
                                   even for an account that already holds the
                                   manager group and only has to move the
                                   sidebar role switch — which left the demo
                                   stalled here with nothing to click. */
                                <p className="text-[10px] text-textSecondary/60 font-semibold mt-1 italic">
                                  Locked: only the Purchase Head releases a PO. Sign in as manager@smartspend.demo, then open Track Request.
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Step 2: Vendor Acknowledgment */}
                          <div className="flex items-start space-x-3 text-xs border-t border-borderTheme/50 pt-3">
                            <div className={`mt-0.5 p-1 rounded-full ${poAcknowledgedByVendor ? 'bg-accent-savings/10 text-accent-savings' : 'bg-textSecondary/10 text-textSecondary'}`}>
                              <CheckCircle2 className="h-4.5 w-4.5" />
                            </div>
                            <div className="flex-grow space-y-1">
                              <p className="font-bold text-textPrimary">3. Vendor Acknowledgment</p>
                              <p className="text-[11px] text-textSecondary leading-relaxed">Simulate receipt confirmation, delivery date commit, and agreement signature from the vendor portal.</p>
                              {poApprovedByHead && !poAcknowledgedByVendor && (
                                canRecordVendorReply ? (
                                  <button
                                    onClick={async () => {
                                      setPoStepBusy('acknowledge');
                                      await recordPurchaseOrderStep(currentRequest.id, 'acknowledge');
                                      setPoStepBusy('');
                                    }}
                                    disabled={poStepBusy === 'acknowledge'}
                                    className="mt-2 px-3 py-1.5 bg-accent-savings hover:opacity-90 disabled:opacity-50 text-[10px] font-bold text-surface rounded shadow-sm transition-all"
                                  >
                                    {poStepBusy === 'acknowledge' ? 'Recording…' : 'Simulate Vendor Acknowledgment'}
                                  </button>
                                ) : (
                                  <p className="text-[10px] text-textSecondary/60 font-semibold mt-1 italic">
                                    Waiting on the vendor to confirm. Sign in as buyer@smartspend.demo or vendor@smartspend.demo, then open Track Request.
                                  </p>
                                )
                              )}
                              {poAcknowledgedByVendor && (
                                <p className="text-[10px] text-accent-savings font-semibold mt-1">✓ Vendor Acknowledged (PO Confirmed)</p>
                              )}
                              {!poApprovedByHead && (
                                <p className="text-[10px] text-textSecondary/60 font-semibold mt-1 italic">Locked: Awaiting Purchase Head approval</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Proceed Button */}
                    <div className="flex justify-between items-center pt-4 border-t border-borderTheme font-outfit">
                      <span className="text-xs text-textSecondary">
                        {!poApprovedByHead && "Awaiting Purchase Head approval..."}
                        {poApprovedByHead && !poAcknowledgedByVendor && "Awaiting Vendor acknowledgment..."}
                        {/* Name who has it next: the buyer or the vendor is the
                            one standing here when the acknowledgment lands, and
                            receiving is not theirs to run. */}
                        {poApprovedByHead && poAcknowledgedByVendor && (canRunFulfilment
                          ? "Workflow steps complete — receiving is yours to run."
                          : "Workflow steps complete — receiving is the purchase manager's.")}
                      </span>
                      <button 
                        onClick={() => {
                          if (poApprovedByHead && poAcknowledgedByVendor) {
                            setActiveScene(12);
                          }
                        }}
                        disabled={!(poApprovedByHead && poAcknowledgedByVendor)}
                        className={`px-5 py-2.5 text-xs font-bold rounded-lg transition-all flex items-center space-x-1 shadow-sm ${
                          (poApprovedByHead && poAcknowledgedByVendor)
                            ? 'bg-textPrimary hover:opacity-90 text-surface cursor-pointer'
                            : 'bg-secondary text-textSecondary/50 border border-borderTheme cursor-not-allowed'
                        }`}
                      >
                        <span>Proceed to Product Receiving</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* --- SCENE 12: PRODUCT RECEIVING & INSPECTION (GRN) --- */}
              {activeScene === 12 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Truck}
                    title="Receive Items"
                    subtitle="Check the delivered items and record what arrived."
                  />

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="md:col-span-3 p-6 rounded-2xl bg-surface border border-borderTheme space-y-6 shadow-sm">
                      <div className="flex items-center space-x-3 text-accent-budget">
                        <Truck className="h-5 w-5" />
                        <h3 className="font-outfit text-lg font-bold text-textPrimary">Goods Receipt Portal</h3>
                      </div>

                      <div className="space-y-4 font-outfit">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">Source PO</span>
                            <span className="text-sm font-semibold text-textPrimary bg-secondary border border-borderTheme rounded-lg p-2 block">PO-2026-003</span>
                          </div>
                          <div>
                            <span className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">Vendor</span>
                            <span className="text-sm font-semibold text-textPrimary bg-secondary border border-borderTheme rounded-lg p-2 block">{currentRequest.vendor || "Primus Technologies"}</span>
                          </div>
                          <div>
                            <span className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">Receiving company</span>
                            <span className="text-sm font-semibold text-textPrimary bg-secondary border border-borderTheme rounded-lg p-2 block">{companyForBranch(currentRequest.location).short}</span>
                          </div>
                          <div>
                            <span className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">Company GSTIN</span>
                            <span className="text-sm font-semibold text-textPrimary bg-secondary border border-borderTheme rounded-lg p-2 block font-mono">{companyForBranch(currentRequest.location).gstin}</span>
                          </div>
                        </div>

                        {/* Per-line receiving — every requested product is inspected and received */}
                        <div>
                          <span className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">Products on this delivery</span>
                          <div className="rounded-xl border border-borderTheme overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs min-w-[460px]">
                                <thead>
                                  <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                                    <th className="text-left font-bold px-3 py-2">Product</th>
                                    <th className="text-right font-bold px-3 py-2">Ordered</th>
                                    <th className="text-right font-bold px-3 py-2 text-accent-budget">Delivered</th>
                                    <th className="text-right font-bold px-3 py-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {currentLines.map((l, i) => {
                                    const got = deliveredQtys[i] ?? l.productQty;
                                    const short = got < l.productQty;
                                    return (
                                      <tr key={i} className="border-t border-borderTheme/60">
                                        <td className="px-3 py-2 text-textPrimary font-semibold">{l.productName}</td>
                                        <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{l.productQty}</td>
                                        <td className="px-3 py-2 text-right">
                                          <input
                                            type="number"
                                            min={0}
                                            value={got}
                                            onChange={(e) => {
                                              const next = currentLines.map((cl, ci) => deliveredQtys[ci] ?? cl.productQty);
                                              next[i] = Number(e.target.value);
                                              setDeliveredQtys(next);
                                              setDeliveredQty(next.reduce((s, n) => s + n, 0));
                                            }}
                                            className="w-20 bg-secondary border border-accent-budget/50 rounded-lg px-2 py-1 text-xs text-textPrimary text-right focus:outline-none focus:border-textPrimary font-semibold tabular-nums"
                                          />
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold ${short ? 'text-accent-approvals' : 'text-accent-savings'}`}>
                                          {short ? `Short by ${l.productQty - got}` : 'Full'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-borderTheme bg-secondary/40 font-bold text-textPrimary">
                                    <td className="px-3 py-2">Total</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{linesQty(currentLines)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{linesQty(receivedLines)}</td>
                                    <td className="px-3 py-2" />
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2">
                          <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                            <input 
                              type="checkbox" 
                              checked={qualityPassed}
                              onChange={(e) => setQualityPassed(e.target.checked)}
                              className="rounded border-borderTheme text-accent-savings focus:ring-accent-savings h-4.5 w-4.5 bg-secondary"
                            />
                            <span className="text-sm text-textSecondary font-medium">Quality Inspection Approved: Items match specs with no defects</span>
                          </label>
                        </div>
                      </div>

                      {grnGenerated ? (
                        <div className="p-4 bg-accent-savings/10 border border-accent-savings/20 rounded-xl space-y-3 animate-fadeIn shadow-sm">
                          <div className="flex items-start space-x-3 text-accent-savings text-xs">
                            <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="font-bold text-textPrimary">Goods Receipt Note (GRN-2026-089) Generated</p>
                              <p className="mt-1 text-textSecondary">Successfully posted. Stock levels updated at Bangalore Warehouse. Handing off to Accounts Payable.</p>
                            </div>
                          </div>
                          <div className="flex justify-end pt-2">
                            <button 
                              onClick={() => {
                                setRequests(prev => prev.map(r => {
                                  if (r.id === selectedRequestId) {
                                    return {
                                      ...r,
                                      history: [...r.history, { title: "Goods Received (GRN-2026-089)", date: "Now", desc: `Received ${deliveredQty}/${r.productQty} units. Quality inspect: PASSED.` }]
                                    };
                                  }
                                  return r;
                                }));
                                setActiveScene(13);
                              }}
                              className="px-5 py-2 bg-textPrimary hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                            >
                              <span>Proceed to 3-Way Match Audit</span>
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 flex justify-end space-x-3">
                          {canRunFulfilment ? (
                            <button 
                              onClick={() => {
                                if (!qualityPassed) {
                                  alert("Please perform quality inspection before generating GRN.");
                                  return;
                                }
                                setGrnGenerated(true);
                              }}
                              className="px-5 py-2.5 bg-accent-savings hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                            >
                              <span>Validate &amp; Generate GRN</span>
                              <Check className="h-4 w-4" />
                            </button>
                          ) : (
                            <StepLock what="only the purchase manager records goods receipt" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="p-5 rounded-2xl bg-surface border border-borderTheme space-y-4 h-fit shadow-sm">
                      <div className="flex items-center space-x-2 text-accent-budget">
                        <Package className="h-4.5 w-4.5" />
                        <h4 className="font-outfit font-extrabold text-sm text-textPrimary">Warehouse Status</h4>
                      </div>
                      <div className="space-y-3 text-xs font-outfit">
                        <div className="flex justify-between">
                          <span className="text-textSecondary">Destination:</span>
                          <span className="font-semibold text-textPrimary">Bangalore Warehouse</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-textSecondary">Carrier:</span>
                          <span className="font-semibold text-textPrimary">Blue Dart Express</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-textSecondary">Waybill Ref:</span>
                          <span className="font-mono text-accent-budget">AWB-77291024</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* --- SCENE 13: VENDOR BILL 3-WAY MATCHING --- */}
              {activeScene === 13 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={ShieldCheck}
                    title="Invoice Check"
                    subtitle="We match the order, the delivery and the invoice automatically."
                  />

                  <div className="p-6 rounded-2xl bg-surface border border-borderTheme space-y-6 shadow-sm">
                    <div className="flex items-center space-x-3 text-accent-budget">
                      <ShieldCheck className="h-5.5 w-5.5" />
                      <h3 className="font-outfit text-lg font-bold text-textPrimary">Reconciliation Matrix</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-outfit">
                      {/* Column 1: PO */}
                      <div className="p-4 rounded-xl bg-secondary border border-borderTheme/70 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-accent-budget uppercase">1. Purchase Order</span>
                          <span className="px-2 py-0.5 rounded bg-accent-savings/10 text-accent-savings font-bold text-[9px] border border-accent-savings/20">PO-2026-003</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Lines Ordered:</span>
                            <span className="font-semibold text-textPrimary">{currentLines.length} product{currentLines.length > 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Qty Ordered:</span>
                            <span className="font-semibold text-textPrimary">{linesQty(currentLines)} units</span>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-borderTheme">
                            <span className="text-textSecondary">Total amount:</span>
                            <span className="font-bold text-textPrimary">₹{linesTotal(currentLines).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Column 2: GRN */}
                      <div className="p-4 rounded-xl bg-secondary border border-borderTheme/70 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-accent-budget uppercase">2. Goods Receipt</span>
                          <span className="px-2 py-0.5 rounded bg-accent-savings/10 text-accent-savings font-bold text-[9px] border border-accent-savings/20">GRN-2026-089</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Lines Received:</span>
                            <span className="font-semibold text-textPrimary">{receivedLines.filter(l => l.productQty > 0).length} of {currentLines.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Qty Received:</span>
                            <span className="font-semibold text-textPrimary">{linesQty(receivedLines)} units</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Quality Check:</span>
                            <span className="font-bold text-accent-savings">PASSED</span>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-borderTheme">
                            <span className="text-textSecondary">Stock Status:</span>
                            <span className="font-bold text-accent-savings">Posted</span>
                          </div>
                        </div>
                      </div>

                      {/* Column 3: Invoice */}
                      <div className="p-4 rounded-xl bg-secondary border border-borderTheme/70 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-accent-budget uppercase">3. Vendor Invoice</span>
                          <span className="px-2 py-0.5 rounded bg-accent-approvals/10 text-accent-approvals font-bold text-[9px] border border-accent-approvals/20">BILL-2026-045</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Lines Billed:</span>
                            <span className="font-semibold text-textPrimary">{receivedLines.length} product{receivedLines.length > 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">Qty Billed:</span>
                            <span className="font-semibold text-textPrimary">{linesQty(receivedLines)} units</span>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-borderTheme">
                            <span className="text-textSecondary">Total Billed:</span>
                            <span className="font-bold text-textPrimary">₹{linesTotal(receivedLines).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-textSecondary">TDS ({TDS.section} @ {tdsRate}%):</span>
                            <span className="font-bold text-neg">−₹{tdsAmount.toLocaleString('en-IN')}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Line-by-line match: every product ordered is received and billed */}
                    <div className="rounded-xl border border-borderTheme overflow-hidden font-outfit">
                      <div className="px-3 py-2 bg-secondary/60 border-b border-borderTheme flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Line-by-line reconciliation</span>
                        <span className="text-[10px] font-bold text-textSecondary">{currentLines.length} product{currentLines.length > 1 ? 's' : ''} billed</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[620px]">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-textFaint">
                              <th className="text-left font-bold px-3 py-2">Product</th>
                              <th className="text-right font-bold px-3 py-2">PO Qty</th>
                              <th className="text-right font-bold px-3 py-2">GRN Qty</th>
                              <th className="text-right font-bold px-3 py-2">Billed Qty</th>
                              <th className="text-right font-bold px-3 py-2">Rate</th>
                              <th className="text-right font-bold px-3 py-2">Billed Amount</th>
                              <th className="text-right font-bold px-3 py-2">Match</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentLines.map((l, i) => {
                              const got = receivedLines[i]?.productQty ?? l.productQty;
                              const matched = got === l.productQty;
                              return (
                                <tr key={i} className="border-t border-borderTheme/60">
                                  <td className="px-3 py-2 text-textPrimary font-semibold">{l.productName}</td>
                                  <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{l.productQty}</td>
                                  <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{got}</td>
                                  <td className="px-3 py-2 text-right text-textSecondary tabular-nums">{got}</td>
                                  <td className="px-3 py-2 text-right text-textSecondary tabular-nums">₹{l.targetPrice.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-textPrimary font-bold tabular-nums">₹{(got * l.targetPrice).toLocaleString()}</td>
                                  <td className={`px-3 py-2 text-right font-bold ${matched ? 'text-accent-savings' : 'text-accent-approvals'}`}>{matched ? '✓ Matched' : 'Qty variance'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-borderTheme bg-secondary/40">
                              <td className="px-3 py-2 font-bold text-textSecondary" colSpan={5}>Invoice total (gross)</td>
                              <td className="px-3 py-2 text-right font-bold text-textPrimary tabular-nums">₹{linesTotal(receivedLines).toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2" />
                            </tr>
                            {/* Withheld from the vendor and paid to the department,
                                so the bill total and the payment differ by exactly
                                this. The rate is a judgement made on the bill, not
                                a constant, so it is typed here rather than fixed. */}
                            <tr className="bg-secondary/40">
                              <td className="px-3 py-2 font-bold text-textSecondary" colSpan={5}>
                                <span className="inline-flex items-center gap-2 flex-wrap">
                                  Less: TDS @
                                  <input
                                    type="number" min={0} max={100} step={0.1}
                                    value={tdsRate}
                                    onChange={e => setTdsRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                                    aria-label="TDS rate percent"
                                    className="w-16 px-2 py-1 rounded-md bg-surface border border-borderTheme text-xs font-bold text-textPrimary text-right focus:outline-none focus:border-brand"
                                  />
                                  %
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/25">
                                    Sec {TDS.section} · {TDS.label}
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-neg tabular-nums">
                                −₹{tdsAmount.toLocaleString('en-IN')}
                              </td>
                              <td className="px-3 py-2" />
                            </tr>
                            {/* Retention, a penalty, a rounding — whatever else
                                comes off this bill. It has no rate, so it is the
                                amount that is typed, and the label with it. */}
                            <tr className="bg-secondary/40">
                              <td className="px-3 py-2 font-bold text-textSecondary" colSpan={5}>
                                <span className="inline-flex items-center gap-2 flex-wrap">
                                  Less:
                                  <input
                                    type="text"
                                    value={otherLabel}
                                    onChange={e => setOtherLabel(e.target.value)}
                                    aria-label="Other amount label"
                                    placeholder="Other amount"
                                    className="w-44 px-2 py-1 rounded-md bg-surface border border-borderTheme text-xs font-bold text-textPrimary focus:outline-none focus:border-brand"
                                  />
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  <span className="text-neg font-bold">−₹</span>
                                  <input
                                    type="number" min={0} step={1}
                                    value={otherDeduction}
                                    onChange={e => setOtherDeduction(Math.max(0, Number(e.target.value) || 0))}
                                    aria-label="Other amount"
                                    className="w-28 px-2 py-1 rounded-md bg-surface border border-borderTheme text-xs font-bold text-neg text-right tabular-nums focus:outline-none focus:border-brand"
                                  />
                                </span>
                              </td>
                              <td className="px-3 py-2" />
                            </tr>
                            <tr className="border-t border-borderTheme bg-secondary/40">
                              <td className="px-3 py-2 font-bold text-textSecondary" colSpan={5}>Net payable to vendor</td>
                              <td className="px-3 py-2 text-right font-extrabold text-accent-budget tabular-nums">
                                ₹{netPayable.toLocaleString('en-IN')}
                              </td>
                              <td className="px-3 py-2" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    <div className="p-5 bg-accent-savings/10 border border-accent-savings/20 rounded-xl flex items-start space-x-3 text-accent-savings text-xs shadow-sm">
                      <CheckCircle2 className="h-5.5 w-5.5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm text-textPrimary font-outfit">3-Way Match Verification Success</p>
                        <p className="mt-1 text-textSecondary text-xs leading-relaxed">All comparison checks pass. PO quantities, GRN warehouse receipts, and the PDF extracted vendor invoice details match 100%. Ready for general ledger posting.</p>
                      </div>
                    </div>

                    {billPosted ? (
                      <div className="p-4 bg-secondary border border-borderTheme rounded-xl flex justify-between items-center animate-fadeIn text-xs shadow-sm">
                        <span className="text-textSecondary">Vendor Bill successfully posted to accounts payable.</span>
                        <button 
                          onClick={() => {
                            setRequests(prev => prev.map(r => {
                              if (r.id === selectedRequestId) {
                                return {
                                  ...r,
                                  history: [...r.history, { title: "Vendor Bill Posted (BILL-2026-045)", date: "Now", desc: `Posted total AP liability of ₹${r.totalCost.toLocaleString()}.` }]
                                };
                              }
                                return r;
                            }));
                            setActiveScene(14);
                          }}
                          className="px-5 py-2 bg-textPrimary hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                        >
                          <span>Proceed to Payment Execution</span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end pt-2">
                        {canRunFulfilment ? (
                          <button 
                            onClick={() => setBillPosted(true)}
                            className="px-5 py-2.5 bg-accent-savings hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                          >
                            <span>Post Vendor Bill to Ledger</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        ) : (
                          <StepLock what="only the purchase manager posts the vendor bill" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* --- SCENE 14: PAYMENT PROCESSING & RECONCILIATION --- */}
              {activeScene === 14 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={CreditCard}
                    title="Make Payment"
                    subtitle="Approve the payment and reconcile the bank records automatically."
                  />

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="md:col-span-3 p-6 rounded-2xl bg-surface border border-borderTheme space-y-6 shadow-sm">
                      <div className="flex items-center space-x-3 text-accent-budget">
                        <CreditCard className="h-5 w-5" />
                        <h3 className="font-outfit text-lg font-bold text-textPrimary">Disbursement Voucher</h3>
                      </div>

                      <div className="space-y-4 text-xs font-outfit">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-textSecondary font-bold uppercase tracking-wider block mb-1">Beneficiary Vendor</span>
                            <span className="text-sm font-semibold text-textPrimary block bg-secondary p-2.5 rounded-lg border border-borderTheme">{currentRequest.vendor || "Primus Technologies"}</span>
                          </div>
                          <div>
                            <span className="text-textSecondary font-bold uppercase tracking-wider block mb-1">Invoice Reference</span>
                            <span className="text-sm font-semibold text-textPrimary block bg-secondary p-2.5 rounded-lg border border-borderTheme font-mono">BILL-2026-045</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-textSecondary font-bold uppercase tracking-wider block mb-1">Paying Bank A/c</span>
                            <span className="text-sm font-semibold text-textPrimary block bg-secondary p-2.5 rounded-lg border border-borderTheme">HDFC Corporate A/c (*9824)</span>
                          </div>
                          <div>
                            <span className="text-textSecondary font-bold uppercase tracking-wider block mb-1">Settlement Amount</span>
                            <span className="text-sm font-extrabold text-accent-budget block bg-secondary p-2.5 rounded-lg border border-borderTheme">
                              ₹{netPayable.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[10px] text-textFaint mt-1 block">
                              ₹{linesTotal(receivedLines).toLocaleString('en-IN')} billed, less ₹{tdsAmount.toLocaleString('en-IN')} TDS under {TDS.section}
                              {otherDeduction > 0 ? ` and ₹${otherDeduction.toLocaleString('en-IN')} ${otherLabel.trim() || 'other'}` : ''}
                            </span>
                          </div>
                        </div>

                        <LineItemsTable lines={receivedLines} title="Invoiced lines being settled" totalLabel="Settlement Amount" />

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-accent-budget font-bold uppercase tracking-wider block mb-1">Payment Method</label>
                            <select 
                              value={paymentMethod}
                              onChange={(e) => setPaymentMethod(e.target.value)}
                              className="w-full bg-secondary border border-borderTheme rounded-lg p-2.5 text-textPrimary focus:outline-none focus:border-textPrimary font-semibold"
                            >
                              <option value="Bank Transfer" className="bg-surface text-textPrimary">Bank Transfer (NEFT/RTGS)</option>
                              <option value="Corporate Card" className="bg-surface text-textPrimary">Corporate Card</option>
                              <option value="UPI Pay" className="bg-surface text-textPrimary">UPI Corporate Pay</option>
                            </select>
                          </div>
                          <div>
                            <span className="text-textSecondary font-bold uppercase tracking-wider block mb-1">Value Date</span>
                            <span className="text-sm font-semibold text-textPrimary block bg-secondary p-2.5 rounded-lg border border-borderTheme">July 13, 2026</span>
                          </div>
                        </div>
                      </div>

                      {paymentComplete ? (
                        <div className="p-4 bg-accent-savings/10 border border-accent-savings/20 rounded-xl space-y-3 animate-fadeIn shadow-sm">
                          <div className="flex items-start space-x-3 text-accent-savings text-xs">
                            <CheckCircle2 className="h-5.5 w-5.5 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="font-bold text-textPrimary font-outfit">Payment Completed &amp; Reconciled</p>
                              <p className="mt-1 text-textSecondary leading-relaxed">Transaction posted successfully. The auto-reconciliation engine verified the bank statement entry against HDFC corporate accounts. Invoice status: PAID.</p>
                            </div>
                          </div>
                          <div className="flex justify-end pt-2">
                            <button 
                              onClick={() => {
                                setRequests(prev => prev.map(r => {
                                  if (r.id === selectedRequestId) {
                                    return {
                                      ...r,
                                      status: "Paid",
                                      history: [...r.history, {
                                        title: "Payment Cleared & Reconciled", date: "Now",
                                        // What was actually transferred, and the
                                        // reference it can be traced by.
                                        desc: `Paid ₹${netPayable.toLocaleString('en-IN')} via ${paymentMethod}`
                                          + ` (₹${billGross.toLocaleString('en-IN')} billed, less ₹${tdsAmount.toLocaleString('en-IN')} TDS`
                                          + (otherDeduction > 0 ? ` and ₹${otherDeduction.toLocaleString('en-IN')} ${otherLabel.trim() || 'other'}` : '')
                                          + `). Ref: ${paymentNote.trim() || 'TXN-98402517'}`,
                                      }]
                                    };
                                  }
                                  return r;
                                }));
                                setActiveScene(15);
                              }}
                              className="px-5 py-2 bg-textPrimary hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                            >
                              <span>Proceed to Spend Intelligence</span>
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 space-y-3">
                          {/* The bank's reference comes back after the transfer
                              is made, and it is what anyone reconciling the
                              statement looks for. Recorded on the request with
                              the payment rather than kept in someone's inbox. */}
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">
                              Payment reference · UTR or note
                            </label>
                            <textarea
                              rows={2}
                              value={paymentNote}
                              onChange={e => setPaymentNote(e.target.value)}
                              placeholder="UTR / NEFT reference, or anything worth recording against this payment…"
                              className="w-full bg-secondary border border-borderTheme rounded-xl p-3 text-xs text-textPrimary focus:outline-none focus:border-brand"
                            />
                          </div>
                          <div className="flex justify-end">
                          {canRunFulfilment ? (
                            <button 
                              onClick={() => setPaymentComplete(true)}
                              className="px-5 py-2.5 bg-accent-savings hover:opacity-90 text-xs font-bold rounded-lg text-surface transition-all flex items-center space-x-1 shadow-sm"
                            >
                              <span>Authorize &amp; Pay Invoice</span>
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          ) : (
                            <StepLock what="only the purchase manager authorises payment" />
                          )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-5 rounded-2xl bg-surface border border-borderTheme space-y-4 h-fit text-xs shadow-sm">
                      <div className="flex items-center space-x-2 text-accent-budget mb-2">
                        <Landmark className="h-4.5 w-4.5" />
                        <h4 className="font-outfit font-extrabold text-sm text-textPrimary">Bank Statement Audit</h4>
                      </div>
                      <div className="space-y-3 font-outfit">
                        <div className="p-3 bg-secondary rounded-lg border border-borderTheme flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-textPrimary">HDFC Bank Ledger</p>
                            <p className="text-[10px] text-textSecondary font-mono">STMT-99281-2026</p>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-accent-savings/10 text-accent-savings font-bold text-[9px] border border-accent-savings/20">Matched</span>
                        </div>
                        <p className="text-textSecondary leading-relaxed text-[11px]">AI matches banking feeds with internal ledgers in real-time, removing manual end-of-month reconciliation tasks.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* --- SCENE 15: spend INTELLIGENCE ANALYTICS --- */}
              {activeScene === 15 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={LayoutDashboard}
                    title="Spend Dashboard"
                    subtitle="A clear view of company spending, savings and alerts."
                    stats={[
                      { label: 'Total spend', value: `₹${dash.spend.toFixed(2)} Cr` },
                      { label: 'AI savings', value: `₹${dash.savings.toFixed(1)} L` },
                      { label: 'Budget used', value: `${dash.budgetUsed.toFixed(1)}%` },
                      { label: 'Cycle time', value: `${dash.cycleAvg.toFixed(1)} d` },
                    ]}
                  />

                  {/* Filters — date range + branch / department / category */}
                  <div className="p-4 rounded-2xl bg-surface border border-borderTheme shadow-sm space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/10 text-brand"><Calendar className="h-4 w-4" /></span>
                      <span className="text-sm font-bold text-textPrimary">Filter by date</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-textFaint">From</label>
                      <input type="month" min={DASH_MONTH_MIN} max={DASH_MONTH_MAX} value={dashFrom} onChange={(e) => setDashFrom(e.target.value)}
                        className="bg-secondary border border-borderTheme rounded-lg px-2.5 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-brand" />
                      <label className="text-xs font-bold uppercase tracking-wider text-textFaint">To</label>
                      <input type="month" min={DASH_MONTH_MIN} max={DASH_MONTH_MAX} value={dashTo} onChange={(e) => setDashTo(e.target.value)}
                        className="bg-secondary border border-borderTheme rounded-lg px-2.5 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-brand" />
                    </div>
                    {/* quick presets */}
                    <div className="flex items-center gap-1.5">
                      {([
                        { label: 'All', from: DASH_MONTH_MIN, to: DASH_MONTH_MAX },
                        { label: 'Q1', from: '2026-01', to: '2026-03' },
                        { label: 'Q2', from: '2026-04', to: '2026-06' },
                        { label: 'Last 3M', from: '2026-05', to: '2026-07' },
                      ]).map(p => {
                        const active = dashFrom === p.from && dashTo === p.to;
                        return (
                          <button key={p.label} onClick={() => { setDashFrom(p.from); setDashTo(p.to); }}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${active ? 'bg-brand text-onbrand' : 'bg-secondary text-textSecondary hover:text-textPrimary'}`}>
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="rounded-full bg-brand/10 text-brand px-3 py-1.5 text-xs font-bold tabular-nums">{dash.rangeLabel} · ₹{dash.spend.toFixed(2)} Cr</span>
                      {!dash.fullRange && (
                        <button onClick={() => { setDashFrom(DASH_MONTH_MIN); setDashTo(DASH_MONTH_MAX); }} className="text-xs font-semibold text-textFaint hover:text-textPrimary">Reset</button>
                      )}
                    </div>
                    </div>

                    {/* Row 2 — focus the breakdown charts on a branch / department / category */}
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-borderTheme/60">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/10 text-brand"><Filter className="h-4 w-4" /></span>
                        <span className="text-sm font-bold text-textPrimary">Filter data</span>
                      </div>
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-textFaint">Branch</span>
                        <select value={dashBranch} onChange={(e) => setDashBranch(e.target.value)}
                          className="bg-secondary border border-borderTheme rounded-lg px-2.5 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-brand">
                          <option value="All">All branches</option>
                          {spendAnalytics.byBranch.map(b => <option key={b.label} value={b.label}>{b.label}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-textFaint">Department</span>
                        <select value={dashDept} onChange={(e) => setDashDept(e.target.value)}
                          className="bg-secondary border border-borderTheme rounded-lg px-2.5 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-brand">
                          <option value="All">All departments</option>
                          {spendAnalytics.byDepartment.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-textFaint">Category</span>
                        <select value={dashCategory} onChange={(e) => setDashCategory(e.target.value)}
                          className="bg-secondary border border-borderTheme rounded-lg px-2.5 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-brand">
                          <option value="All">All categories</option>
                          {spendAnalytics.byCategory.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                        </select>
                      </label>
                      {(dashBranch !== 'All' || dashDept !== 'All' || dashCategory !== 'All') && (
                        <button onClick={() => { setDashBranch('All'); setDashDept('All'); setDashCategory('All'); }}
                          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-textFaint hover:text-textPrimary">
                          <X className="h-3.5 w-3.5" /> Clear filters
                        </button>
                      )}
                    </div>
                  </div>

                  {dash.poCount === 0 ? (
                    <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                      <Filter className="h-8 w-8 mx-auto text-textFaint mb-2" />
                      <p className="text-sm font-semibold text-textPrimary">No spend matches these filters</p>
                      <p className="text-xs text-textFaint mt-1">Try widening the date range, branch, department or category.</p>
                    </div>
                  ) : (
                  <>
                  {/* KPI row — every tile recomputes from the filtered ledger */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-outfit">
                    <StatTile icon={Landmark} tint="78 62 216" value={`₹${dash.spend.toFixed(2)} Cr`} label={dash.fullRange && dash.noCat ? 'Total Spend' : 'Spend (filtered)'}
                      caption={[dash.fullRange ? `${dash.poCount} orders` : `${dash.rangeLabel} 2026`, dashBranch !== 'All' ? dashBranch : null, dashDept !== 'All' ? dashDept : null, dashCategory !== 'All' ? dashCategory : null].filter(Boolean).join(' · ')}
                      delay={0} spark={dash.spark.spend} curr={dash.spend} prev={dash.prev.spend} />
                    <StatTile icon={TrendingUp} tint="12 150 137" value={`₹${dash.savings.toFixed(1)} L`} label="AI Savings"
                      caption={`${dash.savingsPct.toFixed(1)}% of spend`} meter={Math.min(Math.round(dash.savingsPct * 8), 100)} delay={60} spark={dash.spark.savings}
                      curr={dash.savings} prev={dash.prev.savings} />
                    <StatTile icon={Timer} tint="30 118 212" value={`${dash.cycleAvg.toFixed(1)} days`} label="Avg Cycle Time"
                      caption="request → payment" delay={120} spark={dash.spark.cycle}
                      curr={dash.cycleAvg} prev={dash.prev.cycle} lowerIsBetter />
                    <StatTile icon={ShieldAlert} tint="219 58 75" value={String(dash.anomCount)} label="Blocked Anomalies"
                      caption={`₹${dash.anomTotalL.toFixed(2)} L stopped`} delay={180} spark={dash.spark.anomalies}
                      curr={dash.anomCount} prev={dash.prev.anomalies} lowerIsBetter />
                  </div>

                  {/* Budget position + actual-vs-budget trend */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <h3 className="font-outfit font-bold text-textPrimary">Budget Position</h3>
                      <p className="text-[11px] text-textFaint mb-3">{dash.rangeLabel} · committed vs allocation</p>
                      <GaugeArc used={dash.spend} total={dash.budget} />
                      <div className="mt-4 pt-4 border-t border-borderTheme grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-lg font-extrabold font-outfit text-textPrimary tabular-nums">
                            <CountUp value={dash.poCount} />
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">POs raised</p>
                        </div>
                        <div>
                          <p className="text-lg font-extrabold font-outfit text-textPrimary tabular-nums">
                            <CountUp value={dash.vendors} />
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Active vendors</p>
                        </div>
                      </div>
                    </div>
                    <div className="lg:col-span-2 p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="font-outfit font-bold text-textPrimary">Spend vs Budget <span className="text-textFaint font-semibold">· {dash.rangeLabel}</span></h3>
                          <p className="text-[11px] text-textFaint mb-2">Monthly, ₹ Crore — dashed line is the allocation</p>
                        </div>
                        {dash.over ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-neg/10 text-neg px-2.5 py-1 text-[10px] font-bold">
                            <AlertTriangle className="h-3 w-3" /> Over allocation
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-pos/10 text-pos px-2.5 py-1 text-[10px] font-bold">
                            <CheckCircle2 className="h-3 w-3" /> Within budget
                          </span>
                        )}
                      </div>
                      <TrendArea data={dash.months} />
                    </div>
                  </div>

                  {/* Cost-centre and category breakdowns, each with movement */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-brand" />
                        <h3 className="font-outfit font-bold text-textPrimary">Spend by Department{dashDept !== 'All' && <span className="text-brand font-semibold"> · {dashDept}</span>}</h3>
                      </div>
                      <p className="text-[11px] text-textFaint mb-4">Share of total, with change vs last year</p>
                      <BreakdownBars rows={dash.byDept} tint="#6356A8" />
                    </div>
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-pos" />
                        <h3 className="font-outfit font-bold text-textPrimary">Spend by Category{dashCategory !== 'All' && <span className="text-pos font-semibold"> · {dashCategory}</span>}</h3>
                      </div>
                      <p className="text-[11px] text-textFaint mb-4">Share of total, with change vs last year</p>
                      <BreakdownBars rows={dash.byCategory} tint="#5D79BE" />
                    </div>
                  </div>

                  {/* Geography + where the savings actually came from */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <h3 className="font-outfit font-bold text-textPrimary">Spend by Branch{dashBranch !== 'All' && <span className="text-brand font-semibold"> · {dashBranch}</span>}</h3>
                      <p className="text-[11px] text-textFaint mb-4">Where capital is deployed (₹ Crore)</p>
                      <DonutChart data={dash.byBranch} prefix="₹" />
                    </div>
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-gold" />
                        <h3 className="font-outfit font-bold text-textPrimary">Where the ₹{dash.savings.toFixed(1)} L Came From</h3>
                      </div>
                      <p className="text-[11px] text-textFaint mb-4">Savings attributed by lever (₹ Lakh)</p>
                      <BreakdownBars rows={dash.levers} tint="#6356A8" suffix=" L" />
                    </div>
                  </div>

                  {/* Vendor leaderboard + how fast the pipeline moves */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-center gap-2">
                        <Handshake className="h-4 w-4 text-brand" />
                        <h3 className="font-outfit font-bold text-textPrimary">Top Vendors</h3>
                      </div>
                      <p className="text-[11px] text-textFaint mb-3">By spend, with delivery performance</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[460px]">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-textFaint">
                              <th className="text-left font-bold py-2">Vendor</th>
                              <th className="text-right font-bold py-2">Spend</th>
                              <th className="text-right font-bold py-2">Orders</th>
                              <th className="text-right font-bold py-2">On-time</th>
                              <th className="text-right font-bold py-2">Saved</th>
                              <th className="text-right font-bold py-2 w-16">Trend</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dash.topVendors.map(v => (
                              <tr key={v.name} className="border-t border-borderTheme/60">
                                <td className="py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center text-[10px] font-extrabold shrink-0">
                                      {v.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="font-semibold text-textPrimary truncate">{v.name}</p>
                                      <p className="text-[10px] text-textFaint flex items-center gap-0.5">
                                        <Star className="h-2.5 w-2.5 fill-gold text-gold" />{v.rating}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="text-right tabular-nums font-bold text-textPrimary">₹{v.spend.toFixed(2)} Cr</td>
                                <td className="text-right tabular-nums text-textSecondary">{v.orders}</td>
                                <td className="text-right tabular-nums font-bold">
                                  <span className={v.onTime >= 95 ? 'text-pos' : v.onTime >= 90 ? 'text-gold' : 'text-neg'}>{v.onTime}%</span>
                                </td>
                                <td className="text-right tabular-nums text-pos font-bold">₹{v.savings.toFixed(1)} L</td>
                                <td className="py-2.5">
                                  <Sparkline data={v.trend} stroke="#6356A8" className="w-16 h-6 ml-auto" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-info" />
                        <h3 className="font-outfit font-bold text-textPrimary">How Long Each Step Takes</h3>
                      </div>
                      <p className="text-[11px] text-textFaint mb-4">Average days — grey marker is where it sat before AI</p>
                      <div className="space-y-3">
                        {dash.cycleStages.map(s => {
                          const worst = Math.max(...dash.cycleStages.map(c => Math.max(c.days, c.prevDays)), 0.1);
                          return (
                            <div key={s.label}>
                              <div className="flex items-baseline justify-between text-xs mb-1">
                                <span className="text-textSecondary font-medium">{s.label}</span>
                                <span className="font-bold text-textPrimary tabular-nums">
                                  {s.days} d
                                  <span className="text-textFaint font-medium ml-1.5">was {s.prevDays} d</span>
                                </span>
                              </div>
                              <div className="relative h-2.5 rounded-full bg-secondary overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-700"
                                  style={{ width: `${(s.days / worst) * 100}%`, background: '#6356A8' }} />
                                <span className="absolute top-0 bottom-0 w-0.5 bg-textFaint/70"
                                  style={{ left: `${(s.prevDays / worst) * 100}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 pt-4 border-t border-borderTheme">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-2.5">Policy compliance</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                          {dash.compliance.map(c => {
                            const ok = c.pct >= c.target;
                            return (
                              <div key={c.label}>
                                <div className="flex items-baseline justify-between text-[11px]">
                                  <span className="text-textSecondary truncate pr-1">{c.label}</span>
                                  <span className={`font-bold tabular-nums ${ok ? 'text-pos' : 'text-gold'}`}>{c.pct}%</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1">
                                  <div className={`h-full rounded-full ${ok ? 'bg-pos' : 'bg-gold'}`} style={{ width: `${c.pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* What the audit agent caught — filtered along with the rest of the board */}
                  <div className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <ScanLine className="h-4 w-4 text-neg" />
                        <h3 className="font-outfit font-bold text-textPrimary">Issues We Caught</h3>
                      </div>
                      <span className="text-[11px] text-textFaint">{dash.anomCount === 0 ? 'Nothing flagged in this view' : `₹${dash.anomTotalL.toFixed(2)} L of exposure stopped before payment`}</span>
                    </div>
                    {dash.anomalies.length === 0 ? (
                      <div className="mt-4 p-6 text-center rounded-xl bg-pos/5 border border-pos/20">
                        <CheckCircle2 className="h-6 w-6 mx-auto text-pos mb-1.5" />
                        <p className="text-xs font-semibold text-textPrimary">No issues in this selection</p>
                        <p className="text-[11px] text-textFaint mt-0.5">Everything here passed the automated audit.</p>
                      </div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                      {dash.anomalies.map((a, i) => {
                        const tone = a.severity === 'High' ? '219 58 75' : a.severity === 'Medium' ? '194 124 9' : '30 118 212';
                        return (
                          <div key={i} className="req-tile p-4 pl-5" style={{ '--tint': tone } as React.CSSProperties}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-bold text-textPrimary">{a.title}</p>
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                                style={{ background: `rgb(${tone} / 0.12)`, color: `rgb(${tone})` }}>{a.severity}</span>
                            </div>
                            <p className="text-[11px] text-textSecondary mt-1.5">{a.note}</p>
                            <div className="flex items-center justify-between mt-2 text-[11px]">
                              <span className="text-textFaint">{a.vendor} · {a.branch}</span>
                              <span className="font-bold text-textPrimary tabular-nums">{a.amount}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                  </>
                  )}
                </div>
              )}

              {/* --- SCENE 17: QUESTIONS RAISED (MANAGER) --- */}
              {activeScene === 17 && (() => {
                const asked = newestFirst(requests.filter(r => r.status === 'Needs Clarification'));
                return (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={AlertTriangle}
                    title="Questions Raised"
                    subtitle="Requests you have asked about, and what the requester has said back."
                    stats={[{ label: 'Awaiting a reply', value: String(asked.length) }]}
                  />

                  {asked.length === 0 ? (
                    <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-pos mb-2" />
                      <p className="text-sm font-semibold text-textPrimary">Nothing is waiting on an answer</p>
                      <p className="text-xs text-textFaint mt-1">
                        Ask for clarification from the approval queue and the request will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {asked.map(req => (
                        <div key={req.id} id={`req-${req.id}`} className="p-6 rounded-2xl bg-surface border border-gold/30 shadow-sm space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borderTheme pb-3">
                            <div className="min-w-0">
                              <span className="text-xs text-gold font-bold block">{req.id}</span>
                              <h4 className="font-outfit font-extrabold text-lg text-primary truncate">
                                {req.productQty}x {reqSummary(req)}
                              </h4>
                              <p className="text-[11px] text-textSecondary mt-0.5">
                                {req.department} · {req.location} · ₹{req.totalCost.toLocaleString('en-IN')}
                              </p>
                            </div>
                            <span className="px-2 py-0.5 bg-gold/10 text-gold border border-gold/25 rounded-md text-[10px] font-bold shrink-0">
                              AWAITING REPLY
                            </span>
                          </div>

                          {/* The whole exchange, so the answer is read next to
                              the question it answers. */}
                          <div className="space-y-2">
                            {req.clarificationComments.length === 0 ? (
                              <p className="text-xs text-textFaint italic">No question recorded on this request yet.</p>
                            ) : req.clarificationComments.map((c, i) => (
                              <div key={i} className={`p-3 rounded-xl border ${
                                c.role === 'manager'
                                  ? 'bg-secondary border-borderTheme'
                                  : 'bg-brand/5 border-brand/20 ml-6'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-textFaint font-bold uppercase tracking-wider">
                                    {c.role === 'manager' ? 'You asked' : 'Requester replied'}
                                  </span>
                                  <span className="text-[10px] text-textFaint">{c.date}</span>
                                </div>
                                <p className="text-xs text-textSecondary mt-1 font-medium">{c.text}</p>
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => { setSelectedRequestId(req.id); setActiveScene(10); }}
                              className="px-4 py-2 bg-brand hover:brightness-110 text-xs font-bold rounded-lg text-onbrand transition-all flex items-center gap-1.5"
                            >
                              <span>Review &amp; decide</span>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* --- SCENE 18: VENDOR PORTAL --- */}
              {activeScene === 18 && (() => {
                const tab = VENDOR_TABS.find(t => t.key === vendorTab) ?? VENDOR_TABS[0];
                const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
                const Empty = ({ what }: { what: string }) => (
                  <div className="p-12 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
                    <Package className="h-8 w-8 mx-auto text-textFaint mb-2" />
                    <p className="text-sm font-semibold text-textPrimary">Nothing here yet</p>
                    <p className="text-xs text-textFaint mt-1">{what}</p>
                  </div>
                );
                return (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Handshake}
                    title={vendorOwn.length ? vendorCompany : 'Supplier Portal'}
                    subtitle="Your orders, what has been delivered against them, and what is waiting on you."
                    stats={[
                      { label: 'Orders', value: String(vendorOrders.length) },
                      { label: 'Awaiting you', value: String(vendorAwaiting.length) },
                      { label: 'Approved', value: String(vendorApproved.length) },
                    ]}
                  />

                  <div className="flex items-center gap-1.5 p-2 rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-x-auto">
                    {VENDOR_TABS.map(t => {
                      const count = t.key === 'orders' ? vendorOrders.length
                        : t.key === 'receipts' ? vendorReceipts.length
                          : t.key === 'auctions' ? vendorAuctionCount : vendorAwaiting.length;
                      return (
                        <button
                          key={t.key}
                          onClick={() => setVendorTab(t.key)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                            vendorTab === t.key ? 'bg-brand text-onbrand shadow-sm'
                              : 'text-textSecondary hover:text-textPrimary hover:bg-secondary'}`}
                        >
                          <t.icon className="h-3.5 w-3.5" /> {t.label}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            vendorTab === t.key ? 'bg-white/20' : 'bg-raised text-textFaint'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* ---------- LIVE AUCTIONS ---------- */}
                  {vendorTab === 'auctions' && <VendorAuctions api={auctionApi} offline={offlineDemo} />}

                  {/* ---------- CONFIRMED PURCHASE ORDERS ---------- */}
                  {vendorTab === 'orders' && (vendorOrders.length === 0 ? (
                    <Empty what="Orders placed with you will appear here once they are confirmed." />
                  ) : (
                    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[760px]">
                          <thead>
                            <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                              <th className="px-4 py-2.5 font-bold">Order</th>
                              <th className="px-4 py-2.5 font-bold">Against</th>
                              <th className="px-4 py-2.5 font-bold">Items</th>
                              <th className="px-4 py-2.5 font-bold">Deliver to</th>
                              <th className="px-4 py-2.5 font-bold">Needed by</th>
                              <th className="px-4 py-2.5 font-bold text-right">Order value</th>
                              <th className="px-4 py-2.5 font-bold">State</th>
                            </tr>
                          </thead>
                          <tbody>
                            {newestFirst(vendorOrders).map(r => (
                              <tr key={r.id}
                                  onClick={() => setVendorDetailId(r.id)}
                                  className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer">
                                <td className="px-4 py-3 text-[11px] font-mono font-bold text-textPrimary whitespace-nowrap">
                                  {r.purchaseOrders?.join(', ') || '—'}
                                </td>
                                <td className="px-4 py-3 text-[11px] font-mono text-textFaint whitespace-nowrap">{r.id}</td>
                                <td className="px-4 py-3 text-xs font-bold text-textPrimary">{r.productQty}× {reqSummary(r)}</td>
                                <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{r.location}</td>
                                <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{r.deliveryDate || '—'}</td>
                                <td className="px-4 py-3 text-xs font-bold text-textPrimary tabular-nums text-right whitespace-nowrap">{money(r.totalCost)}</td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                        style={{ background: `rgb(${statusRgb(r.status)} / 0.12)`, color: statusColor(r.status), borderColor: `rgb(${statusRgb(r.status)} / 0.25)` }}>
                                    {r.poAcknowledged ? 'Confirmed by you' : r.poReleased ? 'Awaiting your approval' : r.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {/* ---------- RECEIPTS ---------- */}
                  {vendorTab === 'receipts' && (vendorReceipts.length === 0 ? (
                    <Empty what="Deliveries show here once you have confirmed an order." />
                  ) : (
                    <div className="space-y-3">
                      {newestFirst(vendorReceipts).map(r => (
                        <div key={r.id}
                             onClick={() => setVendorDetailId(r.id)}
                             className="p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm cursor-pointer hover:border-brand/40 transition-colors">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borderTheme pb-3">
                            <div className="min-w-0">
                              <span className="text-[11px] font-mono font-bold text-textFaint block">
                                {r.purchaseOrders?.join(', ') || r.id}
                              </span>
                              <h4 className="font-outfit font-extrabold text-base text-textPrimary truncate">
                                {r.productQty}× {reqSummary(r)}
                              </h4>
                            </div>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                              r.status === 'Paid'
                                ? 'bg-pos/10 text-pos border-pos/25'
                                : 'bg-gold/10 text-gold border-gold/25'}`}>
                              {r.status === 'Paid' ? 'Delivered & settled' : 'Delivery due'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
                            {[
                              { l: 'Deliver to', v: r.location },
                              { l: 'Needed by', v: r.deliveryDate || '—' },
                              { l: 'Lines', v: `${(r.lineItems?.length ?? 1)} product${(r.lineItems?.length ?? 1) > 1 ? 's' : ''}` },
                              { l: 'Order value', v: money(r.totalCost) },
                            ].map(f => (
                              <div key={f.l}>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">{f.l}</p>
                                <p className="text-xs font-semibold text-textPrimary mt-0.5">{f.v}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* ---------- APPROVALS ---------- */}
                  {vendorTab === 'approvals' && (
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <h3 className="font-outfit font-extrabold text-lg text-textPrimary">
                          Waiting on you <span className="text-textFaint font-semibold">({vendorAwaiting.length})</span>
                        </h3>
                        {vendorAwaiting.length === 0 ? (
                          <Empty what="Nothing is waiting on your confirmation." />
                        ) : newestFirst(vendorAwaiting).map(r => (
                          <div key={r.id} className="p-5 rounded-2xl bg-surface border border-gold/30 shadow-sm space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <span className="text-[11px] font-mono font-bold text-gold block">
                                  {r.purchaseOrders?.join(', ') || r.id}
                                </span>
                                <h4 className="font-outfit font-extrabold text-base text-textPrimary truncate">
                                  {r.productQty}× {reqSummary(r)}
                                </h4>
                                <p className="text-[11px] text-textSecondary mt-0.5">
                                  Against {r.id} · deliver to {r.location} by {r.deliveryDate || '—'} · {money(r.totalCost)}
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  setPoStepBusy(r.id);
                                  await recordPurchaseOrderStep(r.id, 'acknowledge');
                                  setPoStepBusy('');
                                }}
                                disabled={poStepBusy === r.id}
                                className="px-4 py-2 rounded-lg bg-accent-savings text-surface text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all whitespace-nowrap"
                              >
                                {poStepBusy === r.id ? 'Confirming…' : 'Confirm order'}
                              </button>
                            </div>
                            <LineItemsTable lines={reqLines(r)} title="What you are being asked to supply" totalLabel="Order value" />
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3">
                        <h3 className="font-outfit font-extrabold text-lg text-textPrimary">
                          Approved by you <span className="text-textFaint font-semibold">({vendorApproved.length})</span>
                        </h3>
                        {vendorApproved.length === 0 ? (
                          <Empty what="Orders you have confirmed will be listed here." />
                        ) : (
                          <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left min-w-[620px]">
                                <thead>
                                  <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                                    <th className="px-4 py-2.5 font-bold">Order</th>
                                    <th className="px-4 py-2.5 font-bold">Items</th>
                                    <th className="px-4 py-2.5 font-bold">Deliver to</th>
                                    <th className="px-4 py-2.5 font-bold text-right">Order value</th>
                                    <th className="px-4 py-2.5 font-bold">State</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {newestFirst(vendorApproved).map(r => (
                                    <tr key={r.id}
                                        onClick={() => setVendorDetailId(r.id)}
                                        className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer">
                                      <td className="px-4 py-3 text-[11px] font-mono font-bold text-textPrimary whitespace-nowrap">
                                        {r.purchaseOrders?.join(', ') || r.id}
                                      </td>
                                      <td className="px-4 py-3 text-xs font-bold text-textPrimary">{r.productQty}× {reqSummary(r)}</td>
                                      <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{r.location}</td>
                                      <td className="px-4 py-3 text-xs font-bold text-textPrimary tabular-nums text-right whitespace-nowrap">{money(r.totalCost)}</td>
                                      <td className="px-4 py-3">
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-pos/10 text-pos border border-pos/25">
                                          <Check className="h-3 w-3" /> Confirmed
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* The order a supplier opened, in full: what was ordered, what it
                  is worth, where the delivery stands, and everything recorded
                  against it. A row says which order; this says what is in it. */}
              {activeScene === 18 && vendorDetailId && (() => {
                const r = requests.find(x => x.id === vendorDetailId);
                if (!r) return null;
                const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
                const delivered = r.status === 'Paid';
                const field = (l: string, v: React.ReactNode) => (
                  <div key={l}>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">{l}</p>
                    <p className="text-xs font-semibold text-textPrimary mt-0.5">{v}</p>
                  </div>
                );
                return (
                  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
                       onClick={() => setVendorDetailId(null)}>
                    <div className="w-full max-w-3xl rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto"
                         onClick={e => e.stopPropagation()}>
                      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-borderTheme">
                        <div className="min-w-0">
                          <span className="text-[11px] font-mono font-bold text-textFaint block">
                            {r.purchaseOrders?.join(', ') || 'Order not yet raised'} · against {r.id}
                          </span>
                          <h3 className="font-outfit font-extrabold text-xl text-textPrimary truncate">
                            {r.productQty}× {reqSummary(r)}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border"
                                style={{ background: `rgb(${statusRgb(r.status)} / 0.12)`, color: statusColor(r.status), borderColor: `rgb(${statusRgb(r.status)} / 0.25)` }}>
                            {r.status}
                          </span>
                          <button onClick={() => setVendorDetailId(null)}
                                  title="Close"
                                  className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="px-6 py-5 space-y-6">
                        {/* ---- the order ---- */}
                        <section className="space-y-3">
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-textFaint flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" /> Purchase order
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-secondary border border-borderTheme">
                            {field('Order', r.purchaseOrders?.join(', ') || '—')}
                            {field('Raised on', r.createdDate || '—')}
                            {field('Deliver to', r.location)}
                            {field('Needed by', r.deliveryDate || '—')}
                            {field('Department', r.department)}
                            {field('Buyer', r.buyer || '—')}
                            {field('Lines', `${r.lineItems?.length ?? 1}`)}
                            {field('Order value', money(r.totalCost))}
                          </div>
                          <LineItemsTable lines={reqLines(r)} title="Ordered from you" totalLabel="Order value" />
                        </section>

                        {/* ---- the delivery ---- */}
                        <section className="space-y-3">
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-textFaint flex items-center gap-1.5">
                            <Truck className="h-3.5 w-3.5" /> Receipt
                          </h4>
                          <div className={`p-4 rounded-xl border ${
                            delivered ? 'bg-pos/5 border-pos/25' : 'bg-gold/5 border-gold/25'}`}>
                            <div className="flex items-center gap-2">
                              {delivered ? <CheckCircle2 className="h-4 w-4 text-pos" /> : <Clock className="h-4 w-4 text-gold" />}
                              <p className={`text-sm font-bold ${delivered ? 'text-pos' : 'text-gold'}`}>
                                {delivered ? 'Delivered and settled' : r.poAcknowledged ? 'Confirmed — delivery due' : 'Not yet confirmed by you'}
                              </p>
                            </div>
                            <p className="text-xs text-textSecondary mt-1">
                              {delivered
                                ? 'The goods were received against this order and the invoice has been paid.'
                                : r.poAcknowledged
                                  ? `You confirmed this order. It is expected at ${r.location} by ${r.deliveryDate || 'the agreed date'}.`
                                  : 'This order is waiting on your confirmation before delivery is scheduled.'}
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                              {field('Released to you', r.poReleased ? 'Yes' : 'Not yet')}
                              {field('Confirmed by you', r.poAcknowledged ? 'Yes' : 'Not yet')}
                              {field('Deliver to', r.location)}
                              {field('Needed by', r.deliveryDate || '—')}
                            </div>
                          </div>
                        </section>

                        {/* ---- what has happened to it ---- */}
                        {r.history?.length > 0 && (
                          <section className="space-y-3">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-textFaint flex items-center gap-1.5">
                              <History className="h-3.5 w-3.5" /> Recorded against this order
                            </h4>
                            <div className="space-y-2">
                              {r.history.slice(-6).map((h, i) => (
                                <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-secondary border border-borderTheme">
                                  <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-textPrimary">{h.title}</p>
                                    {h.desc && <p className="text-[11px] text-textSecondary mt-0.5">{h.desc}</p>}
                                  </div>
                                  <span className="ml-auto text-[10px] text-textFaint shrink-0">{h.date}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>

                      <div className="flex justify-between items-center gap-3 px-6 py-4 border-t border-borderTheme">
                        <span className="text-[11px] text-textFaint">
                          {r.poAcknowledged ? 'You have confirmed this order.' : r.poReleased ? 'This order is waiting on your confirmation.' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          {r.poReleased && !r.poAcknowledged && (
                            <button
                              onClick={async () => {
                                setPoStepBusy(r.id);
                                await recordPurchaseOrderStep(r.id, 'acknowledge');
                                setPoStepBusy('');
                              }}
                              disabled={poStepBusy === r.id}
                              className="px-4 py-2 rounded-lg bg-accent-savings text-surface text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all"
                            >
                              {poStepBusy === r.id ? 'Confirming…' : 'Confirm order'}
                            </button>
                          )}
                          <button onClick={() => setVendorDetailId(null)}
                                  className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* --- SCENE 19: LIVE REVERSE AUCTIONS (SCM buyer) --- */}
              {activeScene === 19 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <AuctionDesk
                    api={auctionApi}
                    offline={offlineDemo}
                    requests={requests}
                    launchFor={auctionLaunchFor}
                    onLaunchHandled={() => setAuctionLaunchFor(null)}
                    openAuction={auctionOpen}
                    onOpenHandled={() => setAuctionOpen(null)}
                    onRequestUpdated={swapInRequest}
                  />
                </div>
              )}

              {/* --- SCENE 16: MASTER DATA CONSOLE --- */}
              {activeScene === 16 && (
                <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
                  <SceneHeader
                    icon={Boxes}
                    title="Master Data"
                    subtitle="The reference records every request, contract and purchase order is built on."
                    stats={[
                      { label: 'Products', value: String(productRows.length) },
                      { label: 'Categories', value: String(allCategoryRows.length) },
                      { label: 'Vendors', value: String(vendorRows.length) },
                      { label: 'Branches', value: String(branchRows.length) },
                    ]}
                  />

                  {/* Master switcher */}
                  <div className="p-2 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      {([
                        { key: 'products', label: 'Products', icon: Package, count: productRows.length },
                        { key: 'categories', label: 'Expense Categories', icon: Layers, count: allCategoryRows.length },
                        { key: 'workflow', label: 'Workflow', icon: Activity, count: configuredWorkflows.length || MASTER_WORKFLOW.length },
                        { key: 'company', label: 'Companies', icon: Landmark, count: companyRows.length },
                        { key: 'branches', label: 'Branches', icon: Building2, count: branchRows.length },
                        { key: 'vendors', label: 'Vendors', icon: Handshake, count: vendorRows.length },
                      ] as const).map(t => {
                        const on = mastersTab === t.key;
                        return (
                          <button
                            key={t.key}
                            onClick={() => { setMastersTab(t.key); setMasterSearch(''); }}
                            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                              on ? 'bg-brand text-onbrand border-transparent shadow-sm'
                                 : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}
                          >
                            <t.icon className="h-3.5 w-3.5" />
                            <span>{t.label}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${on ? 'bg-white/20' : 'bg-raised text-textFaint'}`}>{t.count}</span>
                            {t.key === 'vendors' && pendingDrafts.length > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-gold/20 text-gold border border-gold/30 animate-pulse">
                                {pendingDrafts.length} AI
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="relative w-72">
                        <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-textFaint" />
                        <input
                          type="text"
                          value={masterSearch}
                          onChange={(e) => setMasterSearch(e.target.value)}
                          placeholder="Search this master…"
                          className="w-full bg-surface border border-borderTheme rounded-xl pl-9 pr-3 py-2 text-xs text-textPrimary focus:outline-none focus:border-brand"
                        />
                      </div>
                      {/* One button for every master: which one it adds to
                          follows the open tab, so a new master needs a field
                          spec rather than another control. */}
                      {['branches', 'categories'].includes(mastersTab) && (
                        <ViewToggle value={masterView} onChange={setMasterView} />
                      )}
                      {MASTER_FORMS[mastersTab] && (
                        <button
                          onClick={() => setMasterForm({ kind: mastersTab, values: {} })}
                          className="px-3 py-2 rounded-xl bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all"
                        >
                          New {MASTER_FORMS[mastersTab].label}
                        </button>
                      )}
                      <span className="text-[11px] text-textFaint">
                        {masterData ? 'Live data' : 'Offline fallback list — server not reachable'}
                      </span>
                    </div>
                  )}

                  {/* ---------- PRODUCTS ---------- */}
                  {mastersTab === 'products' && (
                    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[720px]">
                          <thead>
                            <tr className="bg-secondary">
                              {['Code', 'Product', 'Category', 'UoM', 'Contract rate', 'Default vendor', 'Status'].map(h => (
                                <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-textFaint">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {productRows
                              .filter(p => `${p.code} ${p.name} ${p.category} ${p.vendor}`.toLowerCase().includes(masterSearch.toLowerCase()))
                              .map(p => (
                                <tr key={p.code} className="border-t border-borderTheme hover:bg-secondary/60 transition-colors">
                                  <td className="px-4 py-3 text-[11px] font-mono text-textFaint">{p.code}</td>
                                  <td className="px-4 py-3 text-xs font-bold text-textPrimary">{p.name}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{p.category}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{p.uom}</td>
                                  <td className="px-4 py-3 text-xs font-bold text-textPrimary tabular-nums">₹{p.contract.toLocaleString('en-IN')}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{p.vendor}</td>
                                  <td className="px-4 py-3">
                                    {p.onContract ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-pos/10 text-pos border border-pos/25">
                                        <ShieldCheck className="h-3 w-3" /> On contract
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/25">
                                        <Search className="h-3 w-3" /> Needs sourcing
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ---------- EXPENSE CATEGORIES ---------- */}
                  {mastersTab === 'categories' && masterView === 'list' && (
                    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[640px]">
                          <thead>
                            <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                              <th className="px-4 py-2.5 font-bold">Category</th>
                              <th className="px-4 py-2.5 font-bold">Expense type</th>
                              <th className="px-4 py-2.5 font-bold">GL code</th>
                              <th className="px-4 py-2.5 font-bold text-right">Approval limit</th>
                              <th className="px-4 py-2.5 font-bold">Owner</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allCategoryRows
                              .filter(c => `${c.name} ${c.expenseType} ${c.glCode}`.toLowerCase().includes(masterSearch.toLowerCase()))
                              .map(c => (
                                <tr key={c.name} className="border-t border-borderTheme hover:bg-secondary/60 transition-colors">
                                  <td className="px-4 py-3 text-xs font-bold text-textPrimary">{c.name}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{c.expenseType}</td>
                                  <td className="px-4 py-3 text-[11px] font-mono text-textFaint">{c.glCode}</td>
                                  <td className="px-4 py-3 text-xs font-bold text-textPrimary tabular-nums text-right">
                                    {c.limit ? `₹${c.limit.toLocaleString('en-IN')}` : '—'}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{c.owner}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {mastersTab === 'categories' && masterView === 'grid' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {allCategoryRows
                        .filter(c => `${c.name} ${c.expenseType} ${c.glCode}`.toLowerCase().includes(masterSearch.toLowerCase()))
                        .map(c => {
                          const capex = /cap/i.test(c.expenseType);
                          const tone = capex ? '99 86 168' : '12 150 137';
                          return (
                            <div key={c.name} className="req-tile p-5 pl-6" style={{ '--tint': tone } as React.CSSProperties}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h4 className="font-outfit font-extrabold text-base text-textPrimary">{c.name}</h4>
                                  <p className="text-[11px] text-textFaint mt-0.5 font-mono">{c.glCode}</p>
                                </div>
                                <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg shrink-0"
                                      style={{ background: `rgb(${tone} / 0.12)`, color: `rgb(${tone})` }}>
                                  {capex ? 'CapEx' : 'OpEx'}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-borderTheme">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">Auto-approve up to</p>
                                  <p className="text-sm font-extrabold text-textPrimary tabular-nums mt-0.5">
                                    {c.limit ? `₹${c.limit.toLocaleString('en-IN')}` : '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">Owning department</p>
                                  <p className="text-xs font-semibold text-textSecondary mt-1">{c.owner}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* ---------- WORKFLOW ---------- */}
                  {mastersTab === 'workflow' && (
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/10 text-brand"><Activity className="h-4 w-4" /></span>
                          <div>
                            <p className="text-sm font-bold text-textPrimary">Approval Workflows</p>
                            <p className="text-[11px] text-textFaint">
                              {workflowRows.length} rule{workflowRows.length === 1 ? '' : 's'} ·
                              who signs depends on department, expense type and value
                            </p>
                          </div>
                        </div>
                        <div className="ml-auto flex items-center gap-3">
                          <span className="text-[11px] text-textFaint">
                            {workflowOverrides.length
                              ? `${workflowOverrides.length} edited here — kept in this browser`
                              : masterData?.workflows ? 'Configured under Configuration ▸ Approval Workflows'
                                : 'Reference process — server not reachable'}
                          </span>
                          <button
                            onClick={() => setWorkflowForm(blankWorkflow())}
                            className="px-3 py-1.5 rounded-lg bg-brand text-onbrand text-[11px] font-bold hover:brightness-110 transition-all"
                          >
                            New workflow
                          </button>
                        </div>
                      </div>

                      {workflowRows.length === 0 ? (
                        /* No matrix reachable: fall back to describing the standard
                           process rather than showing an empty screen. */
                        <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6">
                          <p className="text-xs font-bold text-textFaint uppercase tracking-wider mb-4">Standard process</p>
                          <div className="relative">
                            <div className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-borderTheme" />
                            <div className="space-y-1">
                              {MASTER_WORKFLOW.map(s => (
                                <div key={s.seq} className="relative flex items-start gap-4 py-3">
                                  <span className={`relative z-10 grid h-8 w-8 place-items-center rounded-full text-[11px] font-extrabold shrink-0 border-2 ${
                                    s.auto ? 'bg-pos/10 text-pos border-pos/40' : 'bg-surface text-textSecondary border-borderTheme'}`}>
                                    {s.auto ? <Zap className="h-3.5 w-3.5" /> : s.seq}
                                  </span>
                                  <div className="flex-grow min-w-0 pt-0.5">
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                      <h4 className="text-sm font-bold text-textPrimary">{s.stage}</h4>
                                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-textSecondary border border-borderTheme">{s.role}</span>
                                    </div>
                                    <p className="text-xs text-textSecondary mt-1">{s.rule}</p>
                                  </div>
                                  <span className="text-[11px] font-bold text-textFaint tabular-nums shrink-0 pt-1">{s.sla}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {workflowRows
                            .filter(w => `${w.name} ${w.department} ${w.category} ${w.expenseType} ${w.branch} ${w.approvers.map(a => a.designation).join(' ')}`
                              .toLowerCase().includes(masterSearch.toLowerCase()))
                            .map(w => {
                              const capex = /capital|capex/i.test(w.expenseType);
                              const tone = capex ? '99 86 168' : '12 150 137';
                              return (
                                <div key={w.id} className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                                  <div className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-borderTheme">
                                    <span className="font-mono text-[11px] font-bold text-textFaint">{w.name}</span>
                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                                          style={{ background: `rgb(${tone} / 0.12)`, color: `rgb(${tone})` }}>
                                      {w.expenseType}
                                    </span>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-textSecondary border border-borderTheme">
                                      {w.workflowType}
                                    </span>
                                    <span className="ml-auto text-xs font-bold text-textPrimary tabular-nums">
                                      ₹{w.amountFrom.toLocaleString('en-IN')} – ₹{w.amountTo.toLocaleString('en-IN')}
                                    </span>
                                    <button
                                      onClick={() => setWorkflowForm({ ...w, approvers: w.approvers.map(a => ({ ...a })) })}
                                      className="text-[11px] font-bold text-brand hover:underline px-1"
                                    >
                                      Edit
                                    </button>
                                  </div>

                                  <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/40 border-b border-borderTheme">
                                    {[
                                      { l: 'Department', v: w.department },
                                      { l: 'Branch', v: w.branch },
                                      { l: 'Expense category', v: w.category },
                                      { l: 'Document', v: w.document },
                                    ].map(f => (
                                      <div key={f.l} className="min-w-0">
                                        <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">{f.l}</p>
                                        <p className="text-[11px] font-semibold text-textPrimary truncate">{f.v}</p>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="px-5 py-4">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-3">
                                      Signs in this order — all {w.approvers.length} required
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {w.approvers.map((a, i) => (
                                        <React.Fragment key={`${w.id}-${a.order}`}>
                                          {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-textFaint shrink-0" />}
                                          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand/5 border border-brand/20">
                                            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-onbrand text-[10px] font-extrabold">
                                              {a.order}
                                            </span>
                                            <span className="text-xs font-bold text-textPrimary">{a.designation}</span>
                                          </span>
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ---------- COMPANY ---------- */}
                  {mastersTab === 'company' && (
                    <div className="space-y-4">
                      {companyRows
                        .filter(c => `${c.name} ${c.gstin} ${c.cin} ${c.state}`
                          .toLowerCase().includes(masterSearch.toLowerCase()))
                        .map((c, i) => (
                        <div key={c.gstin} className="p-6 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                          <div className="flex items-center gap-4 pb-5 border-b border-borderTheme">
                            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand border border-borderTheme">
                              <Landmark className="h-7 w-7" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-outfit font-extrabold text-xl text-textPrimary">{c.name}</h3>
                                {i === 0 && (
                                  <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                                    Head entity
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-textSecondary mt-0.5">
                                Registered in {c.state} · {c.branches.length} branch{c.branches.length === 1 ? '' : 'es'} roll up here
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 pt-5">
                            {[
                              { label: 'GSTIN', value: c.gstin, mono: true },
                              { label: 'CIN', value: c.cin, mono: true },
                              { label: 'Base currency', value: 'INR — Indian Rupee' },
                              { label: 'Financial year', value: '1 April – 31 March' },
                              { label: 'Registered state', value: c.state },
                              { label: 'Departments', value: `${departmentRows.length} cost centres` },
                            ].map(f => (
                              <div key={f.label}>
                                <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">{f.label}</p>
                                <p className={`text-sm font-semibold text-textPrimary mt-1 ${f.mono ? 'font-mono' : ''}`}>{f.value}</p>
                              </div>
                            ))}
                          </div>
                          <div className="pt-5 mt-5 border-t border-borderTheme">
                            <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold mb-2">Branches</p>
                            <div className="flex flex-wrap gap-2">
                              {c.branches.map(b => (
                                <span key={b} className="text-[11px] px-2.5 py-1 rounded-lg bg-secondary border border-borderTheme text-textSecondary">
                                  {b}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-textFaint px-1">
                        A request is raised for a branch, so its company — and the GSTIN on its
                        purchase order and goods receipt — follows from that branch.
                      </p>
                    </div>
                  )}

                  {/* Adding a record to whichever master is open. One panel
                      for all of them; the fields come from MASTER_FORMS. */}
                  {masterForm && MASTER_FORMS[masterForm.kind] && (
                    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
                      <div className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
                          <h3 className="font-outfit font-extrabold text-lg text-textPrimary">
                            New {MASTER_FORMS[masterForm.kind].label}
                          </h3>
                          <button onClick={() => setMasterForm(null)}
                                  className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="px-6 py-5 space-y-4">
                          {MASTER_FORMS[masterForm.kind].fields.map(f => (
                            <div key={f.k}>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">
                                {f.l}
                              </label>
                              {f.opts ? (
                                <select
                                  value={masterForm.values[f.k] ?? ''}
                                  onChange={e => setMasterForm({ ...masterForm, values: { ...masterForm.values, [f.k]: e.target.value } })}
                                  className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                                >
                                  <option value="">Choose…</option>
                                  {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <input
                                  type={f.type === 'number' ? 'number' : 'text'}
                                  value={masterForm.values[f.k] ?? ''}
                                  onChange={e => setMasterForm({ ...masterForm, values: { ...masterForm.values, [f.k]: e.target.value } })}
                                  className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                                />
                              )}
                            </div>
                          ))}
                          <p className="text-[11px] text-textFaint bg-secondary/60 border border-borderTheme rounded-lg px-3 py-2">
                            Saved in this browser for the demo. The master data is unchanged —
                            set it under Configuration.
                          </p>
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
                          <button onClick={() => setMasterForm(null)}
                                  className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
                            Cancel
                          </button>
                          <button
                            onClick={saveMasterRecord}
                            disabled={!(masterForm.values.name || '').trim()}
                            title={!(masterForm.values.name || '').trim() ? 'A name is required' : undefined}
                            className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all"
                          >
                            Save {MASTER_FORMS[masterForm.kind].label}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Workflow editor. Create or change a rule and see it in the
                      matrix immediately; it is held in the browser, which the
                      panel says outright rather than implying an ERP save. */}
                  {workflowForm && (
                    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
                      <div className="w-full max-w-2xl rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
                          <div>
                            <h3 className="font-outfit font-extrabold text-lg text-textPrimary">
                              {workflowRows.some(w => w.id === workflowForm.id) ? 'Edit workflow' : 'New workflow'}
                            </h3>
                            <p className="text-[11px] text-textFaint mt-0.5">
                              Which requests this rule catches, and who signs them.
                            </p>
                          </div>
                          <button onClick={() => setWorkflowForm(null)}
                                  className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">Reference</label>
                            <input
                              value={workflowForm.name}
                              onChange={e => setWorkflowForm({ ...workflowForm, name: e.target.value })}
                              placeholder="OPEX-LOW"
                              className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">Expense type</label>
                              <select
                                value={workflowForm.expenseType}
                                onChange={e => setWorkflowForm({ ...workflowForm, expenseType: e.target.value })}
                                className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                              >
                                {['Operating Expenditure (OpEx)', 'Capital Expenditure (CapEx)', 'Any'].map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">Department</label>
                              <select
                                value={workflowForm.department}
                                onChange={e => setWorkflowForm({ ...workflowForm, department: e.target.value })}
                                className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                              >
                                <option value="Any">Any department</option>
                                {departmentRows.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">Value from (₹)</label>
                              <input
                                type="number" min={0} value={workflowForm.amountFrom}
                                onChange={e => setWorkflowForm({ ...workflowForm, amountFrom: Number(e.target.value) || 0 })}
                                className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5">Value to (₹)</label>
                              <input
                                type="number" min={0} value={workflowForm.amountTo}
                                onChange={e => setWorkflowForm({ ...workflowForm, amountTo: Number(e.target.value) || 0 })}
                                className="w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">
                                Signs in this order
                              </label>
                              <button
                                onClick={() => setWorkflowForm({
                                  ...workflowForm,
                                  approvers: [...workflowForm.approvers, {
                                    order: workflowForm.approvers.length + 1,
                                    designation: DESIGNATIONS[0], branch: 'Any', department: 'Any',
                                  }],
                                })}
                                className="text-[11px] font-bold text-brand hover:underline"
                              >
                                Add level
                              </button>
                            </div>
                            <div className="space-y-2">
                              {workflowForm.approvers.map((a, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-onbrand text-[10px] font-extrabold">
                                    {i + 1}
                                  </span>
                                  <select
                                    value={a.designation}
                                    onChange={e => setWorkflowForm({
                                      ...workflowForm,
                                      approvers: workflowForm.approvers.map((x, xi) =>
                                        xi === i ? { ...x, designation: e.target.value } : x),
                                    })}
                                    className="flex-grow text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand"
                                  >
                                    {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                  </select>
                                  <button
                                    onClick={() => setWorkflowForm({
                                      ...workflowForm,
                                      approvers: workflowForm.approvers.filter((_, xi) => xi !== i),
                                    })}
                                    disabled={workflowForm.approvers.length === 1}
                                    title={workflowForm.approvers.length === 1 ? 'A workflow needs at least one signature' : 'Remove this level'}
                                    className="p-1.5 rounded-lg text-textFaint hover:text-neg disabled:opacity-30 disabled:hover:text-textFaint transition-all"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <p className="text-[11px] text-textFaint bg-secondary/60 border border-borderTheme rounded-lg px-3 py-2">
                            Saved in this browser for the demo. the workflow master is
                            unchanged — set it there under Configuration ▸ Approval Workflows.
                          </p>
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
                          <button onClick={() => setWorkflowForm(null)}
                                  className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
                            Cancel
                          </button>
                          <button onClick={saveWorkflow}
                                  className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all">
                            Save workflow
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ---------- BRANCHES ---------- */}
                  {mastersTab === 'branches' && masterView === 'list' && (
                    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[520px]">
                          <thead>
                            <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                              <th className="px-4 py-2.5 font-bold">Code</th>
                              <th className="px-4 py-2.5 font-bold">Branch</th>
                              <th className="px-4 py-2.5 font-bold">City</th>
                              <th className="px-4 py-2.5 font-bold">Company</th>
                            </tr>
                          </thead>
                          <tbody>
                            {branchRows
                              .filter(b => `${b.name} ${b.code} ${b.city}`.toLowerCase().includes(masterSearch.toLowerCase()))
                              .map(b => (
                                <tr key={b.name} className="border-t border-borderTheme hover:bg-secondary/60 transition-colors">
                                  <td className="px-4 py-3 text-[11px] font-mono text-textFaint">{b.code}</td>
                                  <td className="px-4 py-3 text-xs font-bold text-textPrimary">{b.name}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{b.city}</td>
                                  <td className="px-4 py-3 text-xs text-textSecondary">{companyForBranch(b.name).short}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {mastersTab === 'branches' && masterView === 'grid' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {branchRows
                        .filter(b => `${b.name} ${b.code} ${b.city}`.toLowerCase().includes(masterSearch.toLowerCase()))
                        .map((b, i) => (
                          <div key={b.name} className="p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm glow-card">
                            <div className="flex items-start justify-between gap-2">
                              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
                                <Building2 className="h-5 w-5" />
                              </span>
                              {i === 0 && (
                                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                                  Head office
                                </span>
                              )}
                            </div>
                            <h4 className="font-outfit font-extrabold text-base text-textPrimary mt-3">{b.name}</h4>
                            <p className="text-xs text-textSecondary mt-0.5">{b.city}</p>
                            <div className="flex items-center justify-between mt-4 pt-3 border-t border-borderTheme">
                              <span className="text-[11px] font-mono text-textFaint">{b.code}</span>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-pos">
                                <CheckCircle2 className="h-3 w-3" /> Active
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* ---------- VENDORS (master + AI discovery drafts) ---------- */}
                  {mastersTab === 'vendors' && (
                    <div className="space-y-4">
                      {/* Approved master vs AI discovery queue */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setVendorView('master')}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                            vendorView === 'master' ? 'bg-brand text-onbrand border-transparent shadow-sm'
                                                    : 'bg-surface text-textSecondary border-borderTheme hover:text-textPrimary'}`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" /> Approved master
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${vendorView === 'master' ? 'bg-white/20' : 'bg-raised text-textFaint'}`}>{vendorRows.length}</span>
                        </button>
                        <button
                          onClick={() => setVendorView('ai')}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                            vendorView === 'ai' ? 'bg-brand text-onbrand border-transparent shadow-sm'
                                                : 'bg-surface text-textSecondary border-borderTheme hover:text-textPrimary'}`}
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI discovered — drafts
                          {pendingDrafts.length > 0 && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                              vendorView === 'ai' ? 'bg-white/20' : 'bg-gold/20 text-gold border border-gold/30'}`}>
                              {pendingDrafts.length} waiting
                            </span>
                          )}
                        </button>
                      </div>

                      {/* Promotion toast */}
                      {draftToast && (
                        <div className="p-3.5 rounded-xl bg-pos/10 border border-pos/30 flex items-center gap-2.5 text-pos text-xs font-bold animate-fadeIn">
                          <CheckCircle2 className="h-4 w-4 shrink-0" /> {draftToast}
                        </div>
                      )}

                      {/* --- approved vendor master --- */}
                      {vendorView === 'master' && (
                        <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[760px]">
                              <thead>
                                <tr className="bg-secondary">
                                  {['Code', 'Vendor', 'Category', 'Rating', 'Payment terms', 'Since', 'Origin', 'Status'].map(h => (
                                    <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-textFaint">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {vendorRows
                                  .filter(v => `${v.name} ${v.category} ${v.code}`.toLowerCase().includes(masterSearch.toLowerCase()))
                                  .map(v => (
                                    <tr key={v.code + v.name} className={`border-t border-borderTheme hover:bg-secondary/60 transition-colors ${
                                      v.origin === 'AI Discovered' ? 'bg-pos/5' : ''}`}>
                                      <td className="px-4 py-3 text-[11px] font-mono text-textFaint">{v.code}</td>
                                      <td className="px-4 py-3 text-xs font-bold text-textPrimary">{v.name}</td>
                                      <td className="px-4 py-3 text-xs text-textSecondary">{v.category}</td>
                                      <td className="px-4 py-3">
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-textPrimary tabular-nums">
                                          <Star className="h-3 w-3 text-gold fill-gold" /> {v.rating.toFixed(1)}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-xs text-textSecondary">{v.terms}</td>
                                      <td className="px-4 py-3 text-xs text-textSecondary tabular-nums">{v.since}</td>
                                      <td className="px-4 py-3">
                                        {v.origin === 'AI Discovered' ? (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/25">
                                            <Sparkles className="h-3 w-3" /> AI discovered
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold text-textFaint uppercase tracking-wider">Onboarded</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                          v.status === 'Active' ? 'bg-pos/10 text-pos border-pos/25' : 'bg-gold/10 text-gold border-gold/25'}`}>
                                          {v.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* --- AI discovery: drafted vendors awaiting sign-off --- */}
                      {vendorView === 'ai' && (
                        <div className="space-y-4">
                          {/* what the agent did */}
                          <div className="relative overflow-hidden p-5 rounded-2xl bg-surface border border-borderTheme shadow-sm">
                            <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3">
                              <div className="flex items-center gap-3">
                                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
                                  <ScanLine className="h-5 w-5" />
                                </span>
                                <div>
                                  <p className="text-sm font-bold text-textPrimary">Sourcing agent · vendor discovery</p>
                                  <p className="text-[11px] text-textFaint">
                                    Scanned MCA registry, GST portal and 4 B2B directories · {AI_DRAFT_VENDORS.length} suppliers drafted
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 ml-auto">
                                {[
                                  { v: String(pendingDrafts.length), l: 'Awaiting review' },
                                  { v: String(Object.values(draftDecisions).filter(d => d === 'approved').length), l: 'Approved' },
                                  { v: String(Object.values(draftDecisions).filter(d => d === 'rejected').length), l: 'Rejected' },
                                ].map(s => (
                                  <div key={s.l} className="text-center">
                                    <p className="text-lg font-extrabold text-textPrimary font-outfit tabular-nums leading-none">{s.v}</p>
                                    <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint mt-1">{s.l}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {pendingDrafts.length === 0 ? (
                            <div className="p-10 text-center rounded-2xl bg-surface border border-borderTheme">
                              <CheckCircle2 className="h-8 w-8 mx-auto text-pos mb-2" />
                              <p className="text-sm font-bold text-textPrimary">Discovery queue is clear</p>
                              <p className="text-xs text-textFaint mt-1">Every drafted vendor has been reviewed. Approved ones are in the master.</p>
                            </div>
                          ) : pendingDrafts.map(d => {
                            const open = openDraft === d.id;
                            const filled = d.fields.length;
                            const total = filled + d.missing.length;
                            const pct = Math.round((filled / total) * 100);
                            return (
                              <div key={d.id} className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden animate-fadeIn">
                                {/* header row */}
                                <div className="p-5 flex flex-wrap items-center gap-4">
                                  {/* confidence ring */}
                                  <div className="relative h-16 w-16 shrink-0">
                                    <svg viewBox="0 0 44 44" className="h-16 w-16 -rotate-90">
                                      <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4"
                                              className="stroke-borderTheme" />
                                      <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" strokeLinecap="round"
                                              className="stroke-brand"
                                              strokeDasharray={`${(d.aiScore / 100) * 113.1} 113.1`} />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                                      <span className="text-sm font-extrabold text-textPrimary tabular-nums">{d.aiScore}</span>
                                      <span className="text-[8px] font-bold uppercase tracking-wider text-textFaint mt-1">match</span>
                                    </div>
                                  </div>

                                  <div className="flex-grow min-w-[220px]">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="font-outfit font-extrabold text-lg text-textPrimary">{d.name}</h4>
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                                        <FileText className="h-3 w-3" /> Draft · not yet a vendor
                                      </span>
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/25">
                                        <Sparkles className="h-3 w-3" /> AI generated
                                      </span>
                                    </div>
                                    <p className="text-xs text-textSecondary mt-1">
                                      {d.category} · {d.city} · <span className="font-mono text-textFaint">{d.id}</span>
                                    </p>
                                    <p className="text-[11px] text-textFaint mt-1">
                                      Found while sourcing <strong className="text-textSecondary">{d.foundFor}</strong> · {d.foundAt}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-2 ml-auto">
                                    <button
                                      onClick={() => rejectDraftVendor(d)}
                                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-secondary text-textSecondary border border-borderTheme hover:text-neg hover:border-neg/40 transition-all"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => approveDraftVendor(d)}
                                      className="px-4 py-2 rounded-xl text-xs font-bold bg-pos text-onbrand hover:opacity-90 transition-all flex items-center gap-1.5"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve into master
                                    </button>
                                  </div>
                                </div>

                                {/* enrichment meter + signals */}
                                <div className="px-5 pb-4 space-y-3">
                                  <div>
                                    <div className="flex items-baseline justify-between text-[11px] mb-1.5">
                                      <span className="font-bold text-textSecondary">
                                        AI filled {filled} of {total} onboarding fields
                                      </span>
                                      <span className="font-bold text-textPrimary tabular-nums">{pct}%</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                                      <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {d.signals.map(s => (
                                      <span key={s.label}
                                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
                                          s.tone === 'good' ? 'bg-pos/10 text-pos border-pos/25'
                                          : s.tone === 'warn' ? 'bg-gold/10 text-gold border-gold/25'
                                          : 'bg-neg/10 text-neg border-neg/25'}`}>
                                        {s.tone === 'good' ? <Check className="h-3 w-3" />
                                          : s.tone === 'warn' ? <AlertTriangle className="h-3 w-3" />
                                          : <ShieldAlert className="h-3 w-3" />}
                                        {s.label}
                                      </span>
                                    ))}
                                  </div>

                                  {d.missing.length > 0 && (
                                    <p className="text-[11px] text-textFaint">
                                      Still needs a person: <strong className="text-gold">{d.missing.join(' · ')}</strong>
                                    </p>
                                  )}

                                  <button
                                    onClick={() => setOpenDraft(open ? null : d.id)}
                                    className="text-[11px] font-bold text-brand hover:underline flex items-center gap-1"
                                  >
                                    {open ? 'Hide' : 'Show'} what the AI filled and where it came from
                                    <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                                  </button>
                                </div>

                                {/* field-by-field provenance */}
                                {open && (
                                  <div className="border-t border-borderTheme bg-secondary/40 px-5 py-4 animate-fadeIn">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">
                                      {d.fields.map(f => (
                                        <div key={f.label} className="flex items-start gap-3">
                                          <div className="flex-grow min-w-0">
                                            <div className="flex items-baseline justify-between gap-2">
                                              <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">{f.label}</p>
                                              <span className="text-[10px] font-bold text-textSecondary tabular-nums shrink-0">{f.confidence}%</span>
                                            </div>
                                            <p className="text-xs font-semibold text-textPrimary mt-0.5 break-words">{f.value}</p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                              <div className="h-1 flex-grow rounded-full bg-raised overflow-hidden">
                                                <div className={`h-full rounded-full ${f.confidence >= 90 ? 'bg-pos' : f.confidence >= 75 ? 'bg-brand' : 'bg-gold'}`}
                                                     style={{ width: `${f.confidence}%` }} />
                                              </div>
                                              <span className="text-[9px] font-bold uppercase tracking-wider text-textFaint shrink-0">{f.source}</span>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      {d.missing.map(m => (
                                        <div key={m} className="flex items-start gap-3 opacity-70">
                                          <div className="flex-grow min-w-0">
                                            <div className="flex items-baseline justify-between gap-2">
                                              <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">{m}</p>
                                              <span className="text-[10px] font-bold text-gold shrink-0">Missing</span>
                                            </div>
                                            <p className="text-xs font-semibold text-gold mt-0.5">Collect from the vendor before first payment</p>
                                            <div className="h-1 rounded-full bg-raised mt-2.5" />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    <p className="text-[10px] text-textFaint mt-4 pt-3 border-t border-borderTheme">
                                      Nothing here is written until you approve it. Approving creates the partner
                                      record and carries this provenance onto it.
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
            </div>
          </main>
        </div>
      )}
      
    </div>
  );
}
