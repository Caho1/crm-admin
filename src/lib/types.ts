export type UserRole = "admin" | "user";

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  status: "active" | "disabled";
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
};
