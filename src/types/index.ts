// 小红书笔记基础类型
export interface XHSNote {
  id: string;
  title: string;
  desc: string; // 正文
  cover: string; // 封面图URL
  imageList: string[]; // 所有图片URL
  likedCount: number;
  collectedCount: number;
  commentCount: number;
  shareCount: number;
  publishTime: string; // 发布时间
  tags: string[]; // 话题标签
  author: string;
  noteLink: string;
  coverText?: string; // 封面文案（从图片提取）
}

export type SearchMode = "keyword" | "links";

// 飞书采集表记录
export interface FeishuCollectRecord {
  recordId?: string;
  collectDate: string; // 采集日期（具体到分钟）
  searchKeyword: string; // 搜索关键词
  noteLink: string; // 笔记链接
  publishTime: string; // 发布时间
  likedCount: number; // 点赞数
  collectedCount: number; // 收藏数
  commentCount: number; // 评论数
  shareCount: number; // 转发数
  cover: string; // 封面
  coverText: string; // 封面文案
  // 二创相关字段
  rewriteTitleReplaceInfo?: string; // 标题替换信息
  rewriteBodyReplaceInfo?: string; // 正文替换信息
  rewriteCoverReplaceInfo?: string; // 封面文案替换信息
  rewriteDate?: string; // 二创日期
  rewriteTitle?: string; // 二创标题
  rewriteBody?: string; // 二创正文
  rewriteCover?: string; // 二创封面
  rewriteCoverText?: string; // 二创封面文案
  rewriteTags?: string[]; // 二创标签
  publishPersona?: string; // 发布人设
  hasRewritten?: boolean; // 已二创（复选框）
  // 原始笔记内容（在飞书不存储，仅内存用）
  originalTitle?: string;
  originalBody?: string;
  originalTags?: string[];
  originalImages?: string[];
}

// 二创结果
export interface RewriteEditBaseline {
  rewrittenTitle: string;
  rewrittenBody: string;
  rewrittenCover: string;
  rewrittenCoverText: string;
  rewrittenTags: string[];
  publishPersona: string;
}

export interface RewriteResult {
  id: string;
  recordId: string;
  batchIndex: number;
  batchTotal: number;
  originalNote: FeishuCollectRecord;
  rewrittenTitle: string;
  rewrittenBody: string;
  rewrittenCover: string; // 生成的封面图URL
  rewrittenCoverText: string;
  rewrittenTags: string[];
  publishPersona: string;
  titleReplaceInfo: string; // 本次标题生成实际使用的替换信息
  bodyReplaceInfo: string; // 本次正文生成实际使用的替换信息
  coverReplaceInfo: string; // 本次封面文案生成实际使用的替换信息
  editBaseline?: RewriteEditBaseline; // 记录 AI 初始结果，用于判断是否被人工修改
  savedFingerprint?: string; // 当前版本最近一次成功保存的指纹
  status: 'pending' | 'processing' | 'done' | 'error' | 'stopped';
  errorMsg?: string;
}

// 搜索历史记录
export interface SearchHistory {
  id: string;
  mode: SearchMode;
  keyword: string;
  noteLinks?: string[];
  timestamp: string; // ISO时间字符串
  results: XHSNote[];
  filters: SearchFilters;
}

// 搜索筛选条件
export interface SearchFilters {
  sort: 'general' | 'time_descending' | 'popularity_descending' | 'comment_descending' | 'collect_descending';
  timeRange: 'day' | 'week' | 'halfyear' | '';
  minLike?: number;
  minComment?: number;
  minShare?: number;
  minCollect?: number;
}

// 草稿箱本地保存记录
export interface DraftRecord {
  id: string;
  savedAt: string; // ISO时间字符串
  rewriteResults: RewriteResult[];
  feishuTableId?: string; // 飞书表格ID
  feishuTableName?: string; // 飞书表名称
  targetLabel?: string; // 前端展示名称
}

// 当前激活模块
export type ActiveModule = 'crawl' | 'list' | 'rewrite' | 'draft' | 'settings';
