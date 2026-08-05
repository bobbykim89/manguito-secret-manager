import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";

/** Derived from the Pydantic model. Changing HealthData in Python breaks tsc. */
export type HealthData = components["schemas"]["HealthData"];

export function useHealth(): UseQueryResult<HealthData, ApiError> {
  return useQuery<HealthData, ApiError>({
    queryKey: ["health"],
    queryFn: () => client.get<HealthData>("/v1/health"),
    retry: false,
  });
}
