"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const sourceOptions = [
  { label: "Manual", value: "MANUAL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Website", value: "WEBSITE" },
  { label: "Facebook", value: "FB" },
  { label: "Instagram", value: "IG" },
];

const priorityOptions = [
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "VIP", value: "VIP" },
];

interface Department {
  id: string;
  name: string;
}

interface Agent {
  id: string;
  name: string;
}

interface LeadFormData {
  customerName: string;
  customerMobile: string;
  customerEmail: string;
  departmentId: string;
  destination: string;
  travelDate: string;
  numPassengers: string;
  specialRequirement: string;
  source: string;
  priority: string;
  assignedTo: string;
  isFutureInterest: boolean;
}

interface LeadFormProps {
  departments: Department[];
  agents: Agent[];
  onSubmit: (data: LeadFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

const emptyForm: LeadFormData = {
  customerName: "",
  customerMobile: "",
  customerEmail: "",
  departmentId: "",
  destination: "",
  travelDate: "",
  numPassengers: "",
  specialRequirement: "",
  source: "MANUAL",
  priority: "MEDIUM",
  assignedTo: "",
  isFutureInterest: false,
};

export function LeadForm({ departments, agents, onSubmit, onCancel, loading }: LeadFormProps) {
  const [form, setForm] = React.useState<LeadFormData>(emptyForm);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  function set(field: keyof LeadFormData, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const departmentOptions = departments.map((d) => ({ label: d.name, value: d.id }));
  const agentOptions = [
    { label: "Unassigned", value: "" },
    ...agents.map((a) => ({ label: a.name, value: a.id })),
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Customer Name"
          value={form.customerName}
          onChange={(e) => set("customerName", e.target.value)}
          placeholder="Full name"
          required
        />
        <Input
          label="Mobile Number"
          value={form.customerMobile}
          onChange={(e) => set("customerMobile", e.target.value)}
          placeholder="+91 98765 43210"
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Email"
          type="email"
          value={form.customerEmail}
          onChange={(e) => set("customerEmail", e.target.value)}
          placeholder="customer@example.com"
        />
        <Select
          label="Department"
          options={departmentOptions}
          value={form.departmentId}
          onChange={(e) => set("departmentId", e.target.value)}
          placeholder="Select department"
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Destination"
          value={form.destination}
          onChange={(e) => set("destination", e.target.value)}
          placeholder="e.g. Maldives, Bali"
        />
        <Input
          label="Travel Date"
          type="date"
          value={form.travelDate}
          onChange={(e) => set("travelDate", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="Passengers"
          type="number"
          value={form.numPassengers}
          onChange={(e) => set("numPassengers", e.target.value)}
          placeholder="0"
          min="0"
        />
        <Select
          label="Source"
          options={sourceOptions}
          value={form.source}
          onChange={(e) => set("source", e.target.value)}
        />
        <Select
          label="Priority"
          options={priorityOptions}
          value={form.priority}
          onChange={(e) => set("priority", e.target.value)}
        />
      </div>

      <Select
        label="Assign To"
        options={agentOptions}
        value={form.assignedTo}
        onChange={(e) => set("assignedTo", e.target.value)}
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Special Requirements
        </label>
        <textarea
          value={form.specialRequirement}
          onChange={(e) => set("specialRequirement", e.target.value)}
          placeholder="Any special requests or notes..."
          rows={2}
          className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isFutureInterest}
          onChange={(e) => set("isFutureInterest", e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-gray-700">Future interest (not ready to book yet)</span>
      </label>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Create Lead
        </Button>
      </div>
    </form>
  );
}
