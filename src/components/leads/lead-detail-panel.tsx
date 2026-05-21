"use client";

import * as React from "react";
import {
  MapPin,
  Calendar,
  Users,
  Plane,
  Tag,
  Building2,
  FileText,
  Upload,
  Download,
  Trash2,
  File,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";

const priorityVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  VIP: "danger",
};

const sourceLabels: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  FB: "Facebook",
  IG: "Instagram",
  MANUAL: "Manual",
};

interface Stage {
  id: string;
  name: string;
  color: string | null;
}

interface Agent {
  id: string;
  name: string;
}

interface LeadInfo {
  id: string;
  destination: string | null;
  travelDate: string | null;
  numPassengers: number | null;
  specialRequirement: string | null;
  source: string;
  priority: string;
  isFutureInterest: boolean;
  department: { id: string; name: string; color: string | null };
  stage: { id: string; name: string; color: string | null };
  assignee: { id: string; name: string } | null;
}

interface LeadDetailPanelProps {
  lead: LeadInfo;
  stages: Stage[];
  agents: Agent[];
  onChangeStage: (stageId: string) => void;
  onAssignAgent: (agentId: string) => void;
  onScheduleCallback?: () => void;
  onCreateFollowUp?: () => void;
  onEscalate?: () => void;
  onStartConversation?: () => void;
  changingStage?: boolean;
  assigningAgent?: boolean;
}

export function LeadDetailPanel({
  lead,
  stages,
  agents,
  onChangeStage,
  onAssignAgent,
  onScheduleCallback,
  onCreateFollowUp,
  onEscalate,
  onStartConversation,
  changingStage,
  assigningAgent,
}: LeadDetailPanelProps) {
  function formatDate(dateStr: string | null) {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const stageOptions = stages.map((s) => ({ label: s.name, value: s.id }));
  const agentOptions = [
    { label: "Unassigned", value: "" },
    ...agents.map((a) => ({ label: a.name, value: a.id })),
  ];

  return (
    <div className="space-y-4">
      {/* Lead Info Card */}
      <Card header="Lead Information">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Department:</span>
            <Badge
              size="sm"
              style={
                lead.department.color
                  ? { backgroundColor: `${lead.department.color}20`, color: lead.department.color }
                  : undefined
              }
            >
              {lead.department.name}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Stage:</span>
            <Badge
              size="sm"
              style={
                lead.stage.color
                  ? { backgroundColor: `${lead.stage.color}20`, color: lead.stage.color }
                  : undefined
              }
            >
              {lead.stage.name}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Priority:</span>
            <Badge variant={priorityVariant[lead.priority] || "default"} size="sm">
              {lead.priority}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Plane className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Source:</span>
            <span className="text-gray-700">{sourceLabels[lead.source] || lead.source}</span>
          </div>

          {lead.destination && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-gray-500">Destination:</span>
              <span className="text-gray-700">{lead.destination}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Travel Date:</span>
            <span className="text-gray-700">{formatDate(lead.travelDate)}</span>
          </div>

          {lead.numPassengers != null && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-gray-500">Passengers:</span>
              <span className="text-gray-700">{lead.numPassengers}</span>
            </div>
          )}

          {lead.specialRequirement && (
            <div className="flex items-start gap-2 text-sm">
              <FileText className="mt-0.5 h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <span className="text-gray-500">Special Requirements:</span>
                <p className="mt-0.5 text-gray-700">{lead.specialRequirement}</p>
              </div>
            </div>
          )}

          {lead.isFutureInterest && (
            <Badge variant="warning" size="sm">Future Interest</Badge>
          )}
        </div>
      </Card>

      {/* Quick Actions */}
      <Card header="Quick Actions">
        <div className="space-y-3">
          <Select
            label="Change Stage"
            options={stageOptions}
            value={lead.stage.id}
            onChange={(e) => onChangeStage(e.target.value)}
            disabled={changingStage}
          />

          <Select
            label="Assign Agent"
            options={agentOptions}
            value={lead.assignee?.id || ""}
            onChange={(e) => onAssignAgent(e.target.value)}
            disabled={assigningAgent}
          />

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={onScheduleCallback}
            >
              Schedule Callback
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={onCreateFollowUp}
            >
              Create Follow-up
            </Button>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={onStartConversation}
            >
              Start Conversation
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              onClick={onEscalate}
            >
              Escalate
            </Button>
          </div>
        </div>
      </Card>

      {/* File Attachments */}
      <LeadAttachments leadId={lead.id} />
    </div>
  );
}

// ---- Attachments sub-component ----

interface FileRecord {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  uploader: { id: string; name: string };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT_TYPES = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx";

function LeadAttachments({ leadId }: { leadId: string }) {
  const [files, setFiles] = React.useState<FileRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const fetchFiles = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/uploads?leadId=${leadId}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  React.useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("leadId", leadId);

      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm("Delete this file?")) return;
    try {
      const res = await fetch(`/api/uploads/${fileId}`, { method: "DELETE" });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
      }
    } catch {
      // silent
    }
  }

  return (
    <Card header="Attachments">
      <div className="space-y-3">
        {/* Upload button */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_TYPES}
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => inputRef.current?.click()}
            loading={uploading}
          >
            <Upload className="h-4 w-4" />
            Upload File
          </Button>
          <p className="mt-1 text-center text-xs text-gray-400">
            PDF, images, Word, Excel &mdash; max 10MB
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        {/* File list */}
        {loading ? (
          <div className="flex justify-center py-3">
            <Spinner size="sm" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-gray-400">No files attached yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-2">
                <File className="h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-700">{f.fileName}</p>
                  <p className="text-xs text-gray-400">
                    {formatFileSize(f.fileSize)} &middot; {f.uploader.name}
                  </p>
                </div>
                <a
                  href={`/api/uploads/${f.id}`}
                  download
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
