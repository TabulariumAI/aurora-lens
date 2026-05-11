export interface ApiRequestOptions extends RequestInit {
  expectedStatus?: number;
}

export async function requestJson<TResponse>(url: string, options: ApiRequestOptions = {}) {
  const expectedStatus = options.expectedStatus ?? 200;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status !== expectedStatus) {
    throw new Error(`API request failed with HTTP ${response.status}.`);
  }

  return response.json() as Promise<TResponse>;
}
