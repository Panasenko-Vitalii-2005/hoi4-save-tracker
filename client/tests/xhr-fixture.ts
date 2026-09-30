import { vi } from "vitest";

/** Event-driven XHR double. Progress is emitted only when a test requests it. */
export class UploadXhr extends EventTarget {
  static requests: UploadXhr[] = [];
  static onSend: ((request: UploadXhr) => void) | null = null;
  upload = new EventTarget();
  method = "";
  url = "";
  body: FormData | null = null;
  headers = new Headers();
  withCredentials = false;
  status = 0;
  statusText = "";
  responseText = "";
  responseHeaders = "";
  aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  getAllResponseHeaders() { return this.responseHeaders; }
  send(body: FormData) {
    this.body = body;
    UploadXhr.requests.push(this);
    UploadXhr.onSend?.(this);
  }
  abort() {
    this.aborted = true;
    this.dispatchEvent(new Event("abort"));
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(new ProgressEvent("progress", { loaded, total, lengthComputable }));
  }
  uploaded() { this.upload.dispatchEvent(new Event("load")); }
  fail() { this.dispatchEvent(new Event("error")); }
  async respond(response: Response) {
    this.status = response.status;
    this.statusText = response.statusText;
    this.responseHeaders = [...response.headers].map(([name, value]) => `${name}: ${value}`).join("\r\n");
    this.responseText = await response.text();
    if (!this.aborted) this.dispatchEvent(new Event("load"));
  }
}

export function installUploadXhr() {
  UploadXhr.requests = [];
  UploadXhr.onSend = null;
  vi.stubGlobal("XMLHttpRequest", UploadXhr);
}

/** Keep old endpoint/response regression fixtures while exercising real XHR transport. */
export function installUploadXhrUsingFetchFixtures() {
  installUploadXhr();
  UploadXhr.onSend = (request) => {
    void fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: request.headers,
      credentials: request.withCredentials ? "include" : "same-origin",
    }).then((response) => request.respond(response), () => request.fail());
  };
}
