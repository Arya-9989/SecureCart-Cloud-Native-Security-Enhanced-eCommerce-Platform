import { server } from "./server";

/**
 * Resolves when MSW has answered a request matching `method` and `pathname`.
 *
 * Register it *before* the action that triggers the request. Awaiting the actual response
 * event makes a test wait for the app's real milestones (session restored, cart loaded,
 * order placed) instead of racing Testing Library's polling deadline, which is what made
 * these tests flaky on a heavily loaded machine.
 */
export function responseTo(method: string, pathname: string): Promise<Request> {
  return new Promise((resolve) => {
    const listener = ({ request }: { request: Request }) => {
      if (request.method === method && new URL(request.url).pathname === pathname) {
        server.events.removeListener("response:mocked", listener);
        resolve(request);
      }
    };
    server.events.on("response:mocked", listener);
  });
}
