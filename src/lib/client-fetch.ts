"use client";

// 统一的客户端请求封装：会话过期（401）时直接跳转登录页，
// 避免用户在页面上反复操作却只看到「登录已失效」的提示
export async function apiFetch(input: string, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }
  return response;
}
