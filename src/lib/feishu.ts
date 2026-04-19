/**
 * 飞书 Bitable REST API 封装工具库
 * 统一管理 token 获取、记录读写等操作
 */

import "server-only";

import { runtimeConfig } from "@/lib/runtimeConfig";

const FEISHU_BASE_URL = runtimeConfig.feishu.openBaseUrl;
const APP_ID = runtimeConfig.feishu.appId;
const APP_SECRET = runtimeConfig.feishu.appSecret;
const APP_TOKEN = runtimeConfig.feishu.bitableAppToken;
const TABLE_ID = runtimeConfig.feishu.bitableTableId;

let cachedToken: string | null = null;
let tokenExpireAt = 0;

/** 获取 tenant_access_token */
export async function getTenantAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpireAt) return cachedToken;

  const resp = await fetch(`${FEISHU_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`飞书鉴权失败: ${data.msg}`);
  cachedToken = data.tenant_access_token as string;
  tokenExpireAt = Date.now() + (data.expire - 60) * 1000;
  return cachedToken!;
}

/** 通用 Bitable API 请求 */
async function bitableRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getTenantAccessToken();
  const url = `${FEISHU_BASE_URL}/open-apis/bitable/v1${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json() as { code: number; msg: string; data: T };
  if (data.code !== 0) {
    throw new Error(`飞书API错误 [${path}]: code=${data.code} msg=${data.msg}`);
  }
  return data.data;
}

/** 读取指定表的记录（分页） */
export async function getRecordsInTable(
  tableId: string,
  page_size = 100,
  page_token?: string
) {
  const params = new URLSearchParams({ page_size: String(page_size) });
  if (page_token) params.set("page_token", page_token);
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/records?${params}`;
  return bitableRequest<{
    items: Array<{ record_id: string; fields: Record<string, unknown> }>;
    has_more: boolean;
    page_token?: string;
    total: number;
  }>("GET", path);
}

/** 读取采集表所有记录（分页） */
export async function getCollectRecords(page_size = 100, page_token?: string) {
  return getRecordsInTable(TABLE_ID, page_size, page_token);
}

/** 写入采集表记录（批量，每次最多500条） */
export async function createCollectRecords(
  records: Array<{ fields: Record<string, unknown> }>
) {
  const path = `/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`;
  return bitableRequest<{ records: Array<{ record_id: string }> }>("POST", path, { records });
}

/** 更新采集表记录（批量） */
export async function updateCollectRecords(
  records: Array<{ record_id: string; fields: Record<string, unknown> }>
) {
  const path = `/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_update`;
  return bitableRequest<{ records: Array<{ record_id: string }> }>("POST", path, { records });
}

/** 在指定 app 下创建新表 */
export async function createTable(name: string) {
  const path = `/apps/${APP_TOKEN}/tables`;
  return bitableRequest<{ table_id: string }>("POST", path, {
    table: { name },
  });
}

/** 获取 app 下所有表列表 */
export async function listTables() {
  const path = `/apps/${APP_TOKEN}/tables`;
  return bitableRequest<{ items: Array<{ table_id: string; name: string }> }>("GET", path);
}

/** 在指定表写入记录 */
export async function createRecordsInTable(
  tableId: string,
  records: Array<{ fields: Record<string, unknown> }>
) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`;
  return bitableRequest<{ records: Array<{ record_id: string }> }>("POST", path, { records });
}

/** 更新指定表记录（批量） */
export async function updateRecordsInTable(
  tableId: string,
  records: Array<{ record_id: string; fields: Record<string, unknown> }>
) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`;
  return bitableRequest<{ records: Array<{ record_id: string }> }>("POST", path, { records });
}

/** 读取指定表中的单条记录 */
export async function getRecordInTable(tableId: string, recordId: string) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`;
  return bitableRequest<{
    record: { record_id: string; fields: Record<string, unknown> };
  }>("GET", path);
}

/** 删除指定表中的单条记录 */
export async function deleteRecordInTable(tableId: string, recordId: string) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`;
  return bitableRequest<{ deleted: boolean; record_id: string }>("DELETE", path);
}

/** 获取指定表的字段列表 */
export async function getTableFields(tableId: string) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/fields`;
  return bitableRequest<{ items: Array<{ field_id: string; field_name: string; type: number }> }>("GET", path);
}

/** 在指定表新增字段 */
export async function addTableField(
  tableId: string,
  field: { field_name: string; type: number }
) {
  const path = `/apps/${APP_TOKEN}/tables/${tableId}/fields`;
  return bitableRequest("POST", path, field);
}

export async function uploadAttachmentToBitable(params: {
  buffer: ArrayBuffer;
  fileName: string;
  mimeType?: string;
  appToken?: string;
}) {
  const token = await getTenantAccessToken();
  const form = new FormData();
  const appToken = params.appToken || APP_TOKEN;
  const parentType =
    (params.mimeType || "").toLowerCase().startsWith("image/")
      ? "bitable_image"
      : "bitable_file";

  form.append("file_name", params.fileName);
  form.append("parent_type", parentType);
  form.append("parent_node", appToken);
  form.append("extra", JSON.stringify({ drive_route_token: appToken }));
  form.append("size", String(params.buffer.byteLength));
  form.append(
    "file",
    new Blob([params.buffer], {
      type: params.mimeType || "application/octet-stream",
    }),
    params.fileName
  );

  const resp = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/medias/upload_all`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = (await resp.json()) as {
    code: number;
    msg: string;
    data?: { file_token?: string };
  };

  if (data.code !== 0 || !data.data?.file_token) {
    throw new Error(`飞书附件上传失败: ${data.msg}`);
  }

  return {
    file_token: data.data.file_token,
  };
}

export { APP_TOKEN, TABLE_ID };
