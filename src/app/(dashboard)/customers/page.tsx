"use client";

import * as React from "react";
import {
  Plus,
  Search,
  Eye,
  X,
  Phone,
  Mail,
  MapPin,
  StickyNote,
  Calendar,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  mobile: string;
  alternatePhone: string | null;
  address: string | null;
  notes: string | null;
  totalLeads: number;
  lastLeadDate: string | null;
  createdAt: string;
}

interface Lead {
  id: string;
  destination: string | null;
  priority: string;
  createdAt: string;
  stage: { id: string; name: string; color: string | null };
  department: { id: string; name: string; color: string | null };
}

const emptyForm = {
  name: "",
  mobile: "",
  email: "",
  alternatePhone: "",
  address: "",
  notes: "",
};

const stageColorMap: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  new: "info",
  contacted: "primary",
  qualified: "warning",
  converted: "success",
  lost: "danger",
};

function getStageVariant(stageName: string): "default" | "info" | "warning" | "success" | "danger" | "primary" {
  const lower = stageName.toLowerCase();
  for (const [key, variant] of Object.entries(stageColorMap)) {
    if (lower.includes(key)) return variant;
  }
  return "default";
}

export default function CustomersPage() {
  const { toast } = useToast();

  // List state
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);

  // Create modal state
  const [modalOpen, setModalOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [saving, setSaving] = React.useState(false);

  // Detail panel state
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [customerLeads, setCustomerLeads] = React.useState<Lead[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);

  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch customers
  const fetchCustomers = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      params.set("page", String(page));
      params.set("limit", "20");

      const res = await fetch(`/api/customers?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setCustomers(data.customers);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, toast]);

  React.useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Open detail panel
  async function openDetail(customer: Customer) {
    setSelectedCustomer(customer);
    setPanelOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setSelectedCustomer(data.customer);
      setCustomerLeads(data.leads);
    } catch {
      toast("error", "Failed to load customer details");
    } finally {
      setDetailLoading(false);
    }
  }

  // Create customer
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("warning", "Name is required");
      return;
    }
    if (!form.mobile.trim()) {
      toast("warning", "Mobile number is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create customer");
      }

      toast("success", "Customer created");
      setModalOpen(false);
      setForm(emptyForm);
      fetchCustomers();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create customer");
    } finally {
      setSaving(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" subtitle={`${total} total customers`}>
        <Button onClick={() => { setForm(emptyForm); setModalOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </PageHeader>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or mobile..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>

      {/* Customer table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Total Leads</TableHead>
                  <TableHead>Last Lead Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-gray-500">
                      {debouncedQuery
                        ? "No customers match your search."
                        : "No customers yet. Add your first customer to get started."}
                    </TableCell>
                  </TableRow>
                ) : (
                  customers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(customer)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={customer.name} size="sm" />
                          <span className="font-medium text-gray-900">
                            {customer.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <Phone className="h-3.5 w-3.5 text-gray-400" />
                          {customer.mobile}
                        </span>
                      </TableCell>
                      <TableCell>
                        {customer.email ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <Mail className="h-3.5 w-3.5 text-gray-400" />
                            {customer.email}
                          </span>
                        ) : (
                          <span className="text-gray-400">--</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={customer.totalLeads > 0 ? "primary" : "default"}>
                          {customer.totalLeads}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatDate(customer.lastLeadDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(customer);
                          }}
                          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * 20 + 1}--{Math.min(page * 20, total)} of {total}
                </p>
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Customer Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Customer"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Customer name"
            required
          />
          <Input
            label="Mobile Number"
            value={form.mobile}
            onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
            placeholder="+91 98765 43210"
            required
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="customer@example.com"
          />
          <Input
            label="Alternate Phone"
            value={form.alternatePhone}
            onChange={(e) => setForm((f) => ({ ...f, alternatePhone: e.target.value }))}
            placeholder="Alternate number"
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Full address"
              rows={2}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes"
              rows={2}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create Customer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Detail Slide-out Panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/50" onClick={() => setPanelOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Customer Details</h2>
              <button
                onClick={() => setPanelOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner size="lg" />
                </div>
              ) : selectedCustomer ? (
                <div className="space-y-6">
                  {/* Customer info card */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={selectedCustomer.name} size="lg" />
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {selectedCustomer.name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          Customer since {formatDate(selectedCustomer.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700">{selectedCustomer.mobile}</span>
                      </div>
                      {selectedCustomer.alternatePhone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-500">{selectedCustomer.alternatePhone} (alt)</span>
                        </div>
                      )}
                      {selectedCustomer.email && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-700">{selectedCustomer.email}</span>
                        </div>
                      )}
                      {selectedCustomer.address && (
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-700">{selectedCustomer.address}</span>
                        </div>
                      )}
                      {selectedCustomer.notes && (
                        <div className="flex items-start gap-2 text-sm">
                          <StickyNote className="mt-0.5 h-4 w-4 text-gray-400" />
                          <span className="text-gray-600">{selectedCustomer.notes}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-gray-200 p-3 text-center">
                        <p className="text-2xl font-bold text-gray-900">
                          {selectedCustomer.totalLeads}
                        </p>
                        <p className="text-xs text-gray-500">Total Leads</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-3 text-center">
                        <p className="text-sm font-medium text-gray-900">
                          {formatDate(selectedCustomer.lastLeadDate)}
                        </p>
                        <p className="text-xs text-gray-500">Last Lead</p>
                      </div>
                    </div>
                  </div>

                  {/* Leads list */}
                  <div>
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Leads ({customerLeads.length})
                    </h4>
                    {customerLeads.length === 0 ? (
                      <p className="text-sm text-gray-400">No leads yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {customerLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className="rounded-lg border border-gray-200 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant={getStageVariant(lead.stage.name)} size="sm">
                                  {lead.stage.name}
                                </Badge>
                                <Badge variant="default" size="sm">
                                  {lead.department.name}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
                              {lead.destination && (
                                <span>{lead.destination}</span>
                              )}
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(lead.createdAt)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
