import { defineComponents } from "blume";
import Analytics from "./components/Analytics.astro";
import ProviderCard from "./components/ProviderCard.astro";

export default defineComponents({
	mdx: {
		ProviderCard,
	},
	layout: {
		// Renders nothing visible; loads visit tracking on every page.
		Footer: Analytics,
	},
});
