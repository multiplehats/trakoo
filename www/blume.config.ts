import { defineConfig } from "blume";

export default defineConfig({
	title: "trakoo",
	description: "Typed analytics for TypeScript. Define events once and send them to any provider.",
	basePath: "/docs",
	logo: {
		image: {
			light: "/trakoo-logo.png",
			dark: "/trakoo-logo.png",
			alt: "trakoo",
		},
		text: "",
		href: "/docs",
	},
	content: {
		root: "content/docs",
	},
	deployment: {
		site: "https://stacksee-analytics.vercel.app",
	},
	navigation: {
		sidebar: {
			display: "group",
		},
		repo: true,
	},
	github: {
		owner: "multiplehats",
		repo: "trakoo",
	},
	seo: {
		og: {
			enabled: true,
			palette: {
				accent: "#ff5238",
				background: "#0b0b0c",
				foreground: "#f7f5f2",
				muted: "#8e8d91",
				border: "#29282b",
			},
		},
	},
});
