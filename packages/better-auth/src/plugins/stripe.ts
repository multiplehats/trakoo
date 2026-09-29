import type { AuthEventKey } from "../events.js";
import { currentEndpointContext } from "../request.js";
import { type PluginEvents, type Toolkit, findPlugin } from "../toolkit.js";

type Subscription = {
	id: string;
	plan?: string;
	status?: string;
	referenceId?: string;
	billingInterval?: string | null;
	trialStart?: unknown;
};

/** Events of the `stripe` plugin, from its subscription callbacks. */
export function stripeEvents({
	emit,
	wrap,
	currentAuthContext,
}: Toolkit): PluginEvents {
	const subscriptionEvent =
		(key: AuthEventKey, started = false) =>
		(data: unknown) => {
			const row = (data as { subscription?: Subscription } | undefined)
				?.subscription;
			if (!row?.id || !row.referenceId) return;
			const adapter = currentAuthContext()?.internalAdapter;
			emit(key, currentEndpointContext(), async () => {
				// A subscription belongs to a user or to an organization.
				const referenceId = row.referenceId as string;
				const user = await adapter?.findUserById?.(referenceId);
				const owner = user
					? { userId: referenceId }
					: { organizationId: referenceId };
				return {
					userId: owner.userId,
					properties: {
						subscriptionId: row.id,
						plan: row.plan ?? "unknown",
						...(row.status && { status: row.status }),
						...(owner.organizationId && {
							organizationId: owner.organizationId,
						}),
						...(started && {
							...(row.billingInterval && { interval: row.billingInterval }),
							trial: Boolean(row.trialStart),
						}),
					},
				};
			});
		};

	return {
		init(context) {
			const subscription = findPlugin(context, "stripe")?.options
				?.subscription as Record<string, unknown> | undefined;
			if (!subscription) return;
			wrap(
				subscription,
				"onSubscriptionComplete",
				subscriptionEvent("subscriptionStarted", true),
			);
			wrap(
				subscription,
				"onSubscriptionCreated",
				subscriptionEvent("subscriptionStarted", true),
			);
			wrap(
				subscription,
				"onSubscriptionUpdate",
				subscriptionEvent("subscriptionUpdated"),
			);
			wrap(
				subscription,
				"onSubscriptionCancel",
				subscriptionEvent("subscriptionCanceled"),
			);
			wrap(
				subscription,
				"onSubscriptionDeleted",
				subscriptionEvent("subscriptionEnded"),
			);
		},
	};
}
