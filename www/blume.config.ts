import { defineConfig } from "blume";

export default defineConfig({
	title: "StackSee Analytics",
	basePath: "/docs",
	content: {
		root: "content/docs",
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
});
