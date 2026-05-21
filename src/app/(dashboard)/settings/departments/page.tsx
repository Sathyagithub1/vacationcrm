"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsDepartmentsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/departments");
  }, [router]);

  return (
    <div className="flex h-32 items-center justify-center text-sm text-gray-400">
      Redirecting to Departments...
    </div>
  );
}
