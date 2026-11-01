export type XRMode = "immersive-vr" | "immersive-ar";
export interface XRSessionLike {
  end(): Promise<void>;
  addEventListener(type: "end", listener: () => void, options?: {once?: boolean}): void;
}
export interface XRHelperLike {
  enterXRAsync(mode: XRMode, space: string): Promise<{session?: XRSessionLike | null}>;
  dispose?(): void;
}
export async function supportedXRMode(xr?: {isSessionSupported(mode: XRMode): Promise<boolean>}): Promise<XRMode | null> {
  if (!xr) return null;
  for (const mode of ["immersive-vr", "immersive-ar"] as const) {
    try { if (await xr.isSessionSupported(mode)) return mode; } catch { /* Try the other mode. */ }
  }
  return null;
}

export class XRController {
  private helper: XRHelperLike | null = null;
  private session: XRSessionLike | null = null;
  private disposed = false;
  constructor(private onEnded: () => void) {}
  get active(): boolean { return !!this.session; }
  async enter(mode: XRMode, create: () => Promise<XRHelperLike>): Promise<void> {
    if (this.disposed || this.helper) throw Error("XR is already starting or active.");
    const helper = await create();
    if (this.disposed) { helper.dispose?.(); throw Error("Window closed while entering XR."); }
    this.helper = helper;
    try {
      const result = await helper.enterXRAsync(mode, "local-floor");
      const session = result.session;
      if (!session) throw Error("The browser did not return an XR session.");
      if (this.disposed) { await session.end().catch(() => {}); throw Error("Window closed while entering XR."); }
      this.session = session;
      session.addEventListener("end", () => {
        if (this.session !== session) return;
        this.session = null;
        this.helper = null;
        helper.dispose?.();
        if (!this.disposed) this.onEnded();
      }, {once: true});
    } catch (error) {
      if (this.helper === helper) { this.helper = null; helper.dispose?.(); }
      throw error;
    }
  }
  async exit(): Promise<void> {
    if (!this.session) throw Error("No XR session is active.");
    const session = this.session;
    await session.end();
    // Some runtimes emit the end event later; do not leave an active button.
    if (this.session === session) {
      this.session = null;
      const helper = this.helper;
      this.helper = null;
      helper?.dispose?.();
      if (!this.disposed) this.onEnded();
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const session = this.session, helper = this.helper;
    this.session = null;
    this.helper = null;
    if (session) void session.end().catch(() => {});
    helper?.dispose?.();
  }
}
