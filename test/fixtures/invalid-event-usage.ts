import { defineEvents, typed } from "../../src/index.js";
import { createClientAnalytics } from "../../src/client/index.js";

const events = defineEvents({
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: typed<{ orderId: string; amount: string }>(),
	},
});

const analytics = createClientAnalytics({ events });

analytics.track("purchase_compeleted", {
	orderId: "order_1",
	amount: "49",
});
analytics.track("purchase_completed", {
	total: "49",
});
