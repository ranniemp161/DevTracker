import type { RequestUpload } from '@devtrack/types';
import { api } from '@/lib/api';

/**
 * Uploads one declared file straight to storage with its presigned URL, reporting progress
 * from 0 to 1, then confirms it with the API (decision record 0022 §3).
 */
export async function uploadRequestFile(
  token: string,
  upload: RequestUpload,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    // 412: an earlier try already stored this file (If-None-Match), so confirming is enough.
    xhr.onload = () =>
      xhr.status < 300 || xhr.status === 412 ? resolve() : reject(new Error('upload failed'));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
  onProgress(1);
  await api(`/public/requests/${token}/attachments/${upload.id}/complete`, { method: 'POST' });
}
