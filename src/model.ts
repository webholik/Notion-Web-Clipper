export type Annotations = Partial<
  Record<'bold' | 'italic' | 'strikethrough' | 'underline' | 'code', boolean>
>;
export interface RichText {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations?: Annotations;
}
export type ContentBlock = { object: 'block'; type: string } & Record<string, any>;
export interface Capture {
  title: string;
  url: string;
  excerpt: string;
  blocks: ContentBlock[];
  warning?: string;
}
// The UI only needs a preview; extracted blocks stay in the background until save.
export interface CapturePreview {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  blockCount: number;
  warning?: string;
}
export interface Connection {
  id: string;
  name: string;
  token: string;
}
export interface Destination {
  id: string;
  name: string;
  kind: 'page' | 'data_source';
  titleProperty: string;
  urlProperty?: string;
}
export interface Job {
  id: string;
  connectionId: string;
  title: string;
  source: string;
  destination: Destination;
  blocks: ContentBlock[];
  next: number;
  status: 'queued' | 'creating' | 'writing' | 'paused' | 'uncertain' | 'done';
  pageId?: string;
  pageUrl?: string;
  inFlight?: { start: number; count: number };
  error?: string;
  createdAt: string;
}
export interface LocalData {
  connections: Connection[];
  jobs: Job[];
  recent: Record<string, Destination>;
  activeConnectionId?: string;
}
export interface PublicState {
  connections: Pick<Connection, 'id' | 'name'>[];
  jobs: Job[];
  recent: Record<string, Destination>;
  activeConnectionId?: string;
}
