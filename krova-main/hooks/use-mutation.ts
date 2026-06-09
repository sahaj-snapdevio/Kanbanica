"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

interface MutationOptions {
  onError?: (error: Error) => void;
  onSuccess?: (data: unknown) => void;
  revalidate?: boolean;
}

interface TriggerOptions {
  body?: unknown;
  errorMessage?: string;
  headers?: Record<string, string>;
  method?: string;
  successMessage?: string;
  url: string;
}

export function useMutation(options?: MutationOptions) {
  const router = useRouter();
  const [isMutating, setIsMutating] = useState(false);

  const trigger = useCallback(
    async (opts: TriggerOptions): Promise<unknown> => {
      setIsMutating(true);
      try {
        const isFormData = opts.body instanceof FormData;
        const res = await fetch(opts.url, {
          method: opts.method ?? "POST",
          headers: isFormData
            ? opts.headers
            : { "Content-Type": "application/json", ...opts.headers },
          body: isFormData
            ? (opts.body as FormData)
            : opts.body == null
              ? undefined
              : JSON.stringify(opts.body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error || opts.errorMessage || `Request failed (${res.status})`
          );
        }

        let data: unknown = null;
        const contentType = res.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          data = await res.json();
        }

        if (opts.successMessage) {
          toast.success(opts.successMessage);
        }

        if (options?.revalidate !== false) {
          router.refresh();
        }

        options?.onSuccess?.(data);
        return data;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : (opts.errorMessage ?? "Something went wrong");
        toast.error(message);
        options?.onError?.(err instanceof Error ? err : new Error(message));
        return null;
      } finally {
        setIsMutating(false);
      }
    },
    [router, options]
  );

  return { trigger, isMutating };
}
