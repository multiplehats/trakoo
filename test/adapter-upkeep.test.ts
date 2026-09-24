import { describe, expect, it } from "vitest";
import {
	applyUpdatesToManifest,
	planSdkUpdate,
	supportedVersions,
	upkeepChangeset,
	upkeepChangesetName,
	upkeepSummary,
} from "../scripts/adapter-upkeep.mjs";

const published = [
	"5.8.0",
	"5.9.0",
	"5.9.1",
	"5.53.0",
	"6.0.0-beta.1",
	"6.0.0",
	"6.2.1",
];

describe("supported SDK versions", () => {
	it("tests the oldest and newest release a single range accepts", () => {
		expect(supportedVersions("^5.9.0", published)).toEqual([
			{ label: "oldest", version: "5.9.0" },
			{ label: "newest", version: "5.53.0" },
		]);
	});

	it("tests the oldest release of every part of a widened range", () => {
		expect(supportedVersions("^5.9.0 || ^6.0.0", published)).toEqual([
			{ label: "oldest ^5.9.0", version: "5.9.0" },
			{ label: "oldest ^6.0.0", version: "6.0.0" },
			{ label: "newest", version: "6.2.1" },
		]);
	});

	it("tests a range with a single release once", () => {
		expect(supportedVersions("^6.2.1", published)).toEqual([
			{ label: "oldest", version: "6.2.1" },
		]);
	});

	it("rejects a range no published release satisfies", () => {
		expect(() => supportedVersions("^7.0.0", published)).toThrow(
			"no published release satisfies oldest",
		);
	});
});

describe("SDK update planning", () => {
	const peer = {
		name: "posthog-node",
		range: "^5.9.0",
		optional: true,
		testedRange: "^5.46.1",
	};

	it("does nothing when the adapter is tested against the latest release", () => {
		expect(planSdkUpdate(peer, "5.46.1")).toBeNull();
		expect(planSdkUpdate(peer, "5.40.0")).toBeNull();
	});

	it("moves the tested release without touching an accepting peer range", () => {
		expect(planSdkUpdate(peer, "5.53.0")).toEqual({
			name: "posthog-node",
			latest: "5.53.0",
			testedRange: { from: "^5.46.1", to: "^5.53.0" },
			range: { from: "^5.9.0", to: "^5.9.0" },
			widened: false,
		});
	});

	it("widens the peer range from the new release instead of replacing it", () => {
		expect(planSdkUpdate(peer, "6.2.1")).toMatchObject({
			range: { from: "^5.9.0", to: "^5.9.0 || ^6.2.1" },
			widened: true,
		});
	});

	it("treats a new 0.x minor as a new release line", () => {
		expect(
			planSdkUpdate(
				{
					name: "sdk",
					range: "^0.2.1",
					optional: false,
					testedRange: "^0.2.1",
				},
				"0.3.0",
			),
		).toMatchObject({
			range: { to: "^0.2.1 || ^0.3.0" },
			widened: true,
		});
	});
});

describe("upkeep output", () => {
	const widened = planSdkUpdate(
		{
			name: "posthog-node",
			range: "^5.9.0",
			optional: true,
			testedRange: "^5.46.1",
		},
		"6.2.1",
	);
	const retested = planSdkUpdate(
		{
			name: "posthog-js",
			range: "^1.268.2",
			optional: true,
			testedRange: "^1.408.1",
		},
		"1.434.12",
	);
	if (!widened || !retested) throw new Error("expected planned updates");

	it("applies tested and peer ranges without mutating the manifest", () => {
		const manifest = {
			peerDependencies: { "posthog-node": "^5.9.0" },
			devDependencies: { "posthog-node": "^5.46.1" },
		};
		expect(applyUpdatesToManifest(manifest, [widened])).toEqual({
			peerDependencies: { "posthog-node": "^5.9.0 || ^6.2.1" },
			devDependencies: { "posthog-node": "^6.2.1" },
		});
		expect(manifest.peerDependencies["posthog-node"]).toBe("^5.9.0");
	});

	it("records a minor changeset only for widened support", () => {
		expect(upkeepChangeset("@trakoo/posthog", [retested])).toBeNull();
		expect(upkeepChangeset("@trakoo/posthog", [widened, retested])).toBe(
			'---\n"@trakoo/posthog": minor\n---\n\nSupport posthog-node 6 (peer range `^5.9.0 || ^6.2.1`)\n',
		);
	});

	it("names a changeset after the releases it adds", () => {
		expect(upkeepChangesetName("posthog", [widened, retested])).toBe(
			"upkeep-posthog-posthog-node-6.2.1.md",
		);
		const scoped = planSdkUpdate(
			{
				name: "@bentonow/bento-node-sdk",
				range: "^0.2.1",
				optional: false,
				testedRange: "^0.2.1",
			},
			"2.0.0",
		);
		if (!scoped) throw new Error("expected a planned update");
		expect(upkeepChangesetName("bento", [scoped])).toBe(
			"upkeep-bento-bentonow-bento-node-sdk-2.0.0.md",
		);
	});

	it("titles the pull request by whether users see a change", () => {
		expect(upkeepSummary("@trakoo/posthog", [retested]).title).toBe(
			"chore(@trakoo/posthog): test against posthog-js@1.434.12",
		);
		expect(upkeepSummary("@trakoo/posthog", [widened, retested]).title).toBe(
			"feat(@trakoo/posthog): support posthog-node@6.2.1",
		);
	});
});
