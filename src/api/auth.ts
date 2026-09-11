// ABOUTME: 认证相关 API 封装
import { http } from '../lib/http';
import type { AuthConfigResponse, HealthResponse, OasUser } from '../types';

export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const { data } = await http.get<AuthConfigResponse>('/auth/config');
  return data;
}

export async function fetchMe(): Promise<OasUser> {
  const { data } = await http.get<{ authenticated: boolean; user: OasUser }>('/auth/me');
  return data.user;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await http.get<HealthResponse>('/health');
  return data;
}
