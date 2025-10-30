import axios, {
  AxiosHeaders,
  type AxiosHeaderValue,
  type AxiosInstance,
  type AxiosRequestConfig,
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

export async function sdkClient<TResponse>(
  config: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await sdkAxios.request<TResponse>(config);
  return response.data;
}
