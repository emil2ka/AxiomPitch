/** Internal routes keep the camera and recognition worker alive. */
export function navigateApp(destination: string) {
  window.history.pushState(null, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
