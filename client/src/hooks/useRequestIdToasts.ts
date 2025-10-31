import { useEffect, useRef } from "react";

import { useToast } from "@/hooks/use-toast";
import { formatRequestId, type RequestIdentifier } from "@/lib/requestId";

interface UseRequestIdToastsOptions {
  context?: string;
}

interface RequestIdToastPayload {
  requestId: string;
  payload: {
    title: string;
    description: string;
    duration: number;
  };
}

interface ComputeToastOptions {
  context?: string;
  displayed: Set<RequestIdentifier>;
  requestIds: RequestIdentifier[] | undefined;
}

export function computeRequestIdToasts({
  context,
  displayed,
  requestIds,
}: ComputeToastOptions): RequestIdToastPayload[] {
  if (!requestIds?.length) {
    return [];
  }

  const idsToDisplay = requestIds.filter((id): id is string => Boolean(id));
  const unseen = idsToDisplay.filter(id => !displayed.has(id));

  return unseen.map(id => ({
    requestId: id,
    payload: {
      title: context ? `${context} pronto` : "Requisição concluída",
      description: `X-Request-Id: ${formatRequestId(id)}`,
      duration: 5000,
    },
  }));
}

export function useRequestIdToasts(
  requestIds: RequestIdentifier[] | undefined,
  options: UseRequestIdToastsOptions = {},
) {
  const { context } = options;
  const displayed = useRef(new Set<RequestIdentifier>());
  const { toast } = useToast();

  useEffect(() => {
    const pending = computeRequestIdToasts({
      context,
      displayed: displayed.current,
      requestIds,
    });

    if (!pending.length) {
      return;
    }

    pending.forEach(({ requestId, payload }) => {
      displayed.current.add(requestId);
      toast(payload);
    });
  }, [context, requestIds, toast]);
}
