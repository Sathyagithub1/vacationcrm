"use client";

import * as React from "react";
import {
  Building2,
  Plus,
  Pencil,
  Power,
  Globe,
  Mail,
  Phone,
  Briefcase,
  ShoppingBag,
  HeartPulse,
  GraduationCap,
  Plane,
  Utensils,
  Car,
  Home,
  Landmark,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { Modal } from "@/components/ui/modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";

interface Department {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { users: number; leads: number };
}

const ICON_OPTIONS = [
  { value: "Building2", label: "Building" },
  { value: "Briefcase", label: "Briefcase" },
  { value: "ShoppingBag", label: "Shopping" },
  { value: "HeartPulse", label: "Health" },
  { value: "GraduationCap", label: "Education" },
  { value: "Plane", label: "Travel" },
  { value: "Utensils", label: "Food" },
  { value: "Car", label: "Automobile" },
  { value: "Home", label: "Real Estate" },
  { value: "Landmark", label: "Finance" },
  { value: "Globe", label: "Globe" },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2,
  Briefcase,
  ShoppingBag,
  HeartPulse,
  GraduationCap,
  Plane,
  Utensils,
  Car,
  Home,
  Landmark,
  Globe,
};

function DepartmentIcon({ icon, color, className }: { icon: string | null; color: string | null; className?: string }) {
  const IconComponent = icon ? iconMap[icon] : Building2;
  const Comp = IconComponent || Building2;
  return <Comp className={className} style={{ color: color || "#6B7280" }} />;
}

const emptyForm = {
  name: "",
  description: "",
  icon: "Building2",
  color: "#3B82F6",
  contactEmail: "",
  contactPhone: "",
  websiteUrl: "",
};

export default function DepartmentsPage() {
  const { toast } = useToast();
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [saving, setSaving] = React.useState(false);

  const fetchDepartments = React.useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDepartments(data.departments);
    } catch {
      toast("error", "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(dept: Department) {
    setEditingId(dept.id);
    setForm({
      name: dept.name,
      description: dept.description || "",
      icon: dept.icon || "Building2",
      color: dept.color || "#3B82F6",
      contactEmail: dept.contactEmail || "",
      contactPhone: dept.contactPhone || "",
      websiteUrl: dept.websiteUrl || "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("warning", "Name is required");
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `/api/departments/${editingId}` : "/api/departments";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", editingId ? "Department updated" : "Department created");
      setModalOpen(false);
      fetchDepartments();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save department");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(dept: Department) {
    if (!confirm(`Deactivate "${dept.name}"? This will mark it as inactive.`)) return;

    try {
      const res = await fetch(`/api/departments/${dept.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to deactivate");
      }
      toast("success", `"${dept.name}" deactivated`);
      fetchDepartments();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to deactivate");
    }
  }

  async function handleReactivate(dept: Department) {
    try {
      const res = await fetch(`/api/departments/${dept.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) throw new Error("Failed to reactivate");
      toast("success", `"${dept.name}" reactivated`);
      fetchDepartments();
    } catch {
      toast("error", "Failed to reactivate department");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" subtitle="Manage your organization departments">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Department
        </Button>
      </PageHeader>

      <div className="rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact Email</TableHead>
              <TableHead>Contact Phone</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-gray-500">
                  No departments yet. Create your first department to get started.
                </TableCell>
              </TableRow>
            ) : (
              departments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                        style={{ backgroundColor: (dept.color || "#3B82F6") + "15" }}
                      >
                        <DepartmentIcon icon={dept.icon} color={dept.color} className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{dept.name}</p>
                        {dept.description && (
                          <p className="text-xs text-gray-500 line-clamp-1">{dept.description}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {dept.contactEmail ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Mail className="h-3.5 w-3.5 text-gray-400" />
                        {dept.contactEmail}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {dept.contactPhone ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Phone className="h-3.5 w-3.5 text-gray-400" />
                        {dept.contactPhone}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {dept.websiteUrl ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Globe className="h-3.5 w-3.5 text-gray-400" />
                        {dept.websiteUrl}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={dept.isActive ? "success" : "default"}>
                      {dept.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(dept)}
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {dept.isActive ? (
                        <button
                          onClick={() => handleDeactivate(dept)}
                          className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                          title="Deactivate"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(dept)}
                          className="rounded-md p-1.5 text-gray-500 hover:bg-green-50 hover:text-green-600"
                          title="Reactivate"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Department" : "Add Department"}
        className="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Department Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Domestic Tours"
            required
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of this department"
              rows={2}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Icon"
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              options={ICON_OPTIONS}
            />
            <ColorPicker
              label="Color"
              value={form.color}
              onChange={(color) => setForm((f) => ({ ...f, color }))}
            />
          </div>

          <Input
            label="Contact Email"
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            placeholder="dept@company.com"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Contact Phone"
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              placeholder="+91 98765 43210"
            />
            <Input
              label="Website URL"
              value={form.websiteUrl}
              onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
              placeholder="https://example.com"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingId ? "Update" : "Create"} Department
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
