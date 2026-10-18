import { extractArticle } from './content';
(globalThis as any).__pocketCapture = () => extractArticle(document);
