"use client";

import {
  MessageSquare,
  ArrowRightLeft,
  UserPlus,
  Phone,
  Mail,
  Settings,
} from "lucide-react";

interface Activity {
  id: string;
  type: string;
  content: unknown;
  user: string;
  customer: string;
  createdAt: string;
}

interface ActivityFeedWidgetProps {
  data: Activity[] | null;
  loading?: boolean;
}

const typeIcons: Record<string, React.ReactNode> = {
  NOTE: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  STAGE_CHANGE: <ArrowRightLeft className="h-3.5 w-3.5 text-purple-500" />,
  ASSIGNMENT: <UserPlus className="h-3.5 w-3.5 text-green-500" />,
  CALL: <Phone className="h-3.5 w-3.5 text-amber-500" />,
  EMAIL: <Mail className="h-3.5 w-3.5 text-cyan-500" />,
  SYSTEM: <Settings className="h-3.5 w-3.5 text-gray-400" />,
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getActivityText(activity: Activity): string {
  const content = activity.content as Record<string, string> | null;
  switch (activity.type) {
    case "NOTE":
      return content?.note || "Added a note";
    case "STAGE_CHANGE":
      return `Stage: ${content?.from || "?"} → ${content?.to || "?"}`;
    case "ASSIGNMENT":
      return `Assigned to ${content?.assignee || "agent"}`;
    case "CALL":
      return "Logged a call";
    case "EMAIL":
      return "Sent an email";
    default:
      return activity.type;
  }
}

export function ActivityFeedWidget({ data, loading }: ActivityFeedWidgetProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="h-6 w-6 animate-pulse rounded-full bg-gray-100" />
            <div className="flex-1">
              <div className="h-3 w-3/4 animate-pulse rounded bg-gray-50" />
              <div className="mt-1 h-3 w-1/2 animate-pulse rounded bg-gray-50" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No activity</div>;
  }

  return (
    <div className="max-h-72 overflow-y-auto">
      <div className="space-y-3">
        {data.map((activity) => (
          <div key={activity.id} className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-50">
              {typeIcons[activity.type] || <Settings className="h-3.5 w-3.5 text-gray-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-800">
                <span className="font-medium">{activity.user}</span>
                <span className="text-gray-500"> - {activity.customer}</span>
              </div>
              <div className="text-xs text-gray-500 truncate">
                {getActivityText(activity)}
              </div>
              <div className="text-[10px] text-gray-400">
                {formatTimeAgo(activity.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
