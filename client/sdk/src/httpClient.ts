import axios, {
  AxiosHeaders,
  type AxiosHeaderValue,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { getApiHeaders } from "../../src/lib/api";

const sdkAxios: AxiosInstance = axios.create({
  withCredentials: true,
});

sdkAxios.interceptors.request.use((config) => {
  const merged = AxiosHeaders.from(getApiHeaders() as Record<string, string>);

  AxiosHeaders.from(config.headers ?? {}).forEach(
    (value: AxiosHeaderValue, key: string): void => {
      merged.set(key, value);
    },
  );

  config.headers = merged;

  return config;
});

export function sdkClient<TResponse>(
  config: AxiosRequestConfig,
): Promise<AxiosResponse<TResponse>> {
  return sdkAxios.request<TResponse>(config);
}
