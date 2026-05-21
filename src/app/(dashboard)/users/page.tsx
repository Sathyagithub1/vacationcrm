"use client";

import * as React from "react";
import {
  UserPlus,
  Search,
  Mail,
  Shield,
  Building2,
  ToggleLeft,
  ToggleRight,
  Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface UserData {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  departmentId: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  department: { id: string; name: string; color: string | null } | null;
}

interface Department {
  id: string;
  name: string;
  color: string | null;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  inviter: { id: string; name: string };
  department: { id: string; name: string } | null;
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  COMPANY_ADMIN: "Company Admin",
  DEPT_MANAGER: "Dept Manager",
  AGENT: "Agent",
  VIEWER: "Viewer",
};

const roleVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  SUPER_ADMIN: "danger",
  COMPANY_ADMIN: "primary",
  DEPT_MANAGER: "warning",
  AGENT: "info",
  VIEWER: "default",
};

const roleOptions = [
  { label: "Company Admin", value: "COMPANY_ADMIN" },
  { label: "Dept Manager", value: "DEPT_MANAGER" },
  { label: "Agent", value: "AGENT" },
  { label: "Viewer", value: "VIEWER" },
];

export default function UsersPage() {
  const { toast } = useToast();

  const [users, setUsers] = React.useState<UserData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");

  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [invitations, setInvitations] = React.useState<PendingInvitation[]>([]);

  // Invite modal state
  const [inviteModalOpen, setInviteModalOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("AGENT");
  const [inviteDept, setInviteDept] = React.useState("");
  const [inviting, setInviting] = React.useState(false);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<UserData | null>(null);
  const [editRole, setEditRole] = React.useState("");
  const [editDept, setEditDept] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch departments
  React.useEffect(() => {
    async function fetchDepts() {
      try {
        const res = await fetch("/api/departments");
        if (res.ok) {
          const data = await res.json();
          setDepartments(data.departments || []);
        }
      } catch {
        // not critical
      }
    }
    fetchDepts();
  }, []);

  // Fetch users
  const fetchUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (debouncedQuery) params.set("q", debouncedQuery);

      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQuery, toast]);

  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Fetch invitations
  const fetchInvitations = React.useCallback(async () => {
    try {
      const res = await fetch("/api/invitations");
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.invitations || []);
      }
    } catch {
      // not critical
    }
  }, []);

  React.useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  // Send invitation
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          departmentId: inviteDept || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send invitation");
      }
      toast("success", `Invitation sent to ${inviteEmail}`);
      setInviteModalOpen(false);
      setInviteEmail("");
      setInviteRole("AGENT");
      setInviteDept("");
      fetchInvitations();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    } finally {
      setInviting(false);
    }
  }

  // Open edit modal
  function openEditModal(u: UserData) {
    setEditTarget(u);
    setEditRole(u.role);
    setEditDept(u.departmentId || "");
    setEditName(u.name);
    setEditModalOpen(true);
  }

  // Save edit
  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editRole,
          departmentId: editDept || null,
          name: editName.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      toast("success", "User updated");
      setEditModalOpen(false);
      setEditTarget(null);
      fetchUsers();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  // Toggle active/inactive
  async function handleToggleActive(u: UserData) {
    const action = u.isActive ? "deactivate" : "activate";
    if (u.isActive && !confirm(`Deactivate ${u.name}? They will lose access.`)) return;
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", u.isActive ? "User deactivated" : "User activated");
      fetchUsers();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
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

  const deptOptions = [
    { label: "No Department", value: "" },
    ...departments.map((d) => ({ label: d.name, value: d.id })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle={`${total} total users`}>
        <Button onClick={() => setInviteModalOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Invite User
        </Button>
      </PageHeader>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-gray-500">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={u.name}
                          imageUrl={u.avatarUrl || undefined}
                          size="sm"
                        />
                        <span className="font-medium text-gray-900">{u.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{u.email}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleVariant[u.role] || "default"} size="sm">
                        {roleLabels[u.role] || u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.department ? (
                        <Badge
                          size="sm"
                          style={
                            u.department.color
                              ? { backgroundColor: `${u.department.color}20`, color: u.department.color }
                              : undefined
                          }
                        >
                          {u.department.name}
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-400">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={u.isActive ? "success" : "default"}
                        size="sm"
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-500">
                        {formatDate(u.lastSeenAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(u)}
                          title="Edit user"
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          title={u.isActive ? "Deactivate" : "Activate"}
                          className={`rounded p-1 ${
                            u.isActive
                              ? "text-red-500 hover:bg-red-50"
                              : "text-green-600 hover:bg-green-50"
                          }`}
                        >
                          {u.isActive ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                      </div>
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
        </div>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Pending Invitations ({invitations.length})
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Invited By</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <span className="text-sm">{inv.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleVariant[inv.role] || "default"} size="sm">
                        {roleLabels[inv.role] || inv.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {inv.department?.name || "--"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{inv.inviter.name}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-500">
                        {formatDate(inv.expiresAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      <Modal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Invite User"
      >
        <form onSubmit={handleInvite} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            required
          />
          <Select
            label="Role"
            options={roleOptions}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          />
          <Select
            label="Department (optional)"
            options={deptOptions}
            value={inviteDept}
            onChange={(e) => setInviteDept(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setInviteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={inviting}>
              <Mail className="h-4 w-4" />
              Send Invitation
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => { setEditModalOpen(false); setEditTarget(null); }}
        title={`Edit User: ${editTarget?.name || ""}`}
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <Input
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
          />
          <Select
            label="Role"
            options={roleOptions}
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
          />
          <Select
            label="Department"
            options={deptOptions}
            value={editDept}
            onChange={(e) => setEditDept(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setEditModalOpen(false); setEditTarget(null); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
