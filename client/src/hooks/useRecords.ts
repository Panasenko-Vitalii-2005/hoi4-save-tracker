import { useEffect, useState } from "react";
import type { SaveRecord } from "@/types";
import { apiFetch } from "@/lib/api-client";

export function useRecords() {
  const [records, setRecords] = useState<SaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(`/api/records?ts=${Date.now()}`);
      const data = (await resp.json()) as {
        records: SaveRecord[];
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);
  return { records, loading, error, reload: load };
}
