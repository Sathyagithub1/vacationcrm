"use client";

import {
  Pencil,
  ArrowRight,
  UserCheck,
  PhoneCall,
  Mail,
  Info,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const typeIcons: Record<string, React.ReactNode> = {
  NOTE: <Pencil className="h-4 w-4" />,
  STAGE_CHANGE: <ArrowRight className="h-4 w-4" />,
  ASSIGNMENT: <UserCheck className="h-4 w-4" />,
  CALL: <PhoneCall className="h-4 w-4" />,
  EMAIL: <Mail className="h-4 w-4" />,
  SYSTEM: <Info className="h-4 w-4" />,
};

const typeColors: Record<string, string> = {
  NOTE: "bg-blue-100 text-blue-600",
  STAGE_CHANGE: "bg-purple-100 text-purple-600",
  ASSIGNMENT: "bg-green-100 text-green-600",
  CALL: "bg-yellow-100 text-yellow-600",
  EMAIL: "bg-pink-100 text-pink-600",
  SYSTEM: "bg-gray-100 text-gray-600",
};

export interface Activity {
  id: string;
  type: string;
  content: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null } | null;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

function formatTimestamp(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderContent(type: string, content: Record<string, unknown> | null) {
  if (!content) return null;

  switch (type) {
    case "NOTE":
      return <p className="text-sm text-gray-700">{content.text as string}</p>;

    case "STAGE_CHANGE": {
      const from = content.from as { name: string } | null;
      const to = content.to as { name: string } | null;
      return (
        <div className="flex items-center gap-2 text-sm">
          {from && <Badge variant="default" size="sm">{from.name}</Badge>}
          <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
          {to && <Badge variant="primary" size="sm">{to.name}</Badge>}
        </div>
      );
    }

    case "ASSIGNMENT": {
      const from = content.from as { name: string } | null;
      const to = content.to as { name: string } | null;
      return (
        <p className="text-sm text-gray-700">
          {from ? (
            <>Reassigned from <strong>{from.name}</strong> to <strong>{to?.name}</strong></>
          ) : (
            <>Assigned to <strong>{to?.name}</strong></>
          )}
        </p>
      );
    }

    case "SYSTEM":
      return <p className="text-sm text-gray-500 italic">{content.message as string}</p>;

    case "CALL":
      return (
        <p className="text-sm text-gray-700">
          {content.duration ? `Call duration: ${content.duration}` : "Phone call logged"}
          {content.notes ? ` - ${content.notes}` : ""}
        </p>
      );

    case "EMAIL":
      return (
        <p className="text-sm text-gray-700">
          {content.subject ? `Subject: ${content.subject}` : "Email logged"}
        </p>
      );

    default:
      return <p className="text-sm text-gray-500">{JSON.stringify(content)}</p>;
  }
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        No activity yet.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {activities.map((activity, idx) => (
        <div key={activity.id} className="relative flex gap-3 pb-6">
          {/* Vertical line */}
          {idx < activities.length - 1 && (
            <div className="absolute left-[15px] top-8 h-full w-px bg-gray-200" />
          )}

          {/* Icon circle */}
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              typeColors[activity.type] || typeColors.SYSTEM
            }`}
          >
            {typeIcons[activity.type] || typeIcons.SYSTEM}
          </div>

          {/* Content */}
          <div className="flex-1 pt-0.5">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {activity.user && (
                <span className="font-medium text-gray-700">{activity.user.name}</span>
              )}
              <span>{formatTimestamp(activity.createdAt)}</span>
            </div>
            <div className="mt-1">
              {renderContent(activity.type, activity.content)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
