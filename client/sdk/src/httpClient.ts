import axios, {
  AxiosHeaders,
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

  AxiosHeaders.from(config.headers ?? {}).forEach((value, key) => {
    merged.set(key, value as string);
  });

  config.headers = merged;

  return config;
});

export function sdkClient<TResponse>(
  config: AxiosRequestConfig,
): Promise<AxiosResponse<TResponse>> {
  return sdkAxios.request<TResponse>(config);
}
