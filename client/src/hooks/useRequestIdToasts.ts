import { useEffect, useRef } from "react";

import { useToast } from "@/hooks/use-toast";
import { formatRequestId, type RequestIdentifier } from "@/lib/requestId";

interface UseRequestIdToastsOptions {
  context?: string;
}

export function useRequestIdToasts(
  requestIds: RequestIdentifier[] | undefined,
  options: UseRequestIdToastsOptions = {},
) {
  const { context } = options;
  const displayed = useRef(new Set<RequestIdentifier>());
  const { toast } = useToast();

  useEffect(() => {
    if (!requestIds?.length) {
      return;
    }

    const idsToDisplay = requestIds.filter((id): id is string => Boolean(id));
    const unseen = idsToDisplay.filter((id) => !displayed.current.has(id));

    if (!unseen.length) {
      return;
    }

    unseen.forEach((id) => {
      displayed.current.add(id);
      const formatted = formatRequestId(id);
      toast({
        title: context ? `${context} pronto` : "Requisição concluída",
        description: `X-Request-Id: ${formatted}`,
        duration: 5000,
      });
    });
  }, [context, requestIds, toast]);
}
