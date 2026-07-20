import Link from "next/link";
import { AnalyticsHero } from "./analytics-hero";
import { AnalyticsPlayground } from "@/components/analytics-playground";
import { Target, Plug, Globe, Package, User, Zap } from "lucide-react";

export default function HomePage() {
	return (
		<div className="flex flex-col min-h-screen">
			{/* Hero Section */}
			<AnalyticsHero />

			{/* Features Grid */}
			<section className="px-4 py-16 bg-fd-background">
				<div className="max-w-6xl mx-auto">
					<h2 className="text-3xl font-bold text-center mb-12">
						Why trakoo?
					</h2>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
						{/* Feature 1 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<Target className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">Fully Type-Safe</h3>
							<p className="text-fd-muted-foreground">
								Define events once, get autocomplete and type checking
								everywhere. No more typos or wrong properties.
							</p>
						</div>

						{/* Feature 2 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<Plug className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">Provider Agnostic</h3>
							<p className="text-fd-muted-foreground">
								Use PostHog, Bento, Pirsch, or any service. Switch providers
								without changing your tracking code.
							</p>
						</div>

						{/* Feature 3 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<Globe className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">Universal API</h3>
							<p className="text-fd-muted-foreground">
								Same API works on client and server. Write once, track
								everywhere with full type safety.
							</p>
						</div>

						{/* Feature 4 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<Package className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">Zero Dependencies</h3>
							<p className="text-fd-muted-foreground">
								Core library has zero dependencies. Providers are optional and
								fully tree-shakeable.
							</p>
						</div>

						{/* Feature 5 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<User className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">User Context</h3>
							<p className="text-fd-muted-foreground">
								Identify users once, context flows to all events automatically.
								Works on client and server.
							</p>
						</div>

						{/* Feature 6 */}
						<div className="p-6 rounded-lg border border-fd-border bg-fd-card">
							<div className="mb-4 size-12 rounded-lg bg-primary/10 flex items-center justify-center">
								<Zap className="size-6 text-primary" />
							</div>
							<h3 className="text-xl font-semibold mb-2">Edge Ready</h3>
							<p className="text-fd-muted-foreground">
								Works in serverless, edge runtimes, and long-running servers.
								Optimized for modern platforms.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Interactive Playground */}
			<section className="px-4 py-16 bg-fd-background">
				<div className="max-w-6xl mx-auto">
					<div className="text-center mb-12">
						<h2 className="text-3xl font-bold mb-4">See It In Action</h2>
						<p className="text-fd-muted-foreground max-w-2xl mx-auto">
							Try the interactive playground below. Click around the product and
							watch events flow to multiple analytics providers in real-time.
						</p>
					</div>
					<AnalyticsPlayground
						showHeader={false}
						showFooter={false}
						compact={true}
					/>
					<div className="text-center mt-8">
						<Link
							href="/docs/playground"
							className="inline-flex items-center gap-2 text-fd-primary hover:underline font-medium"
						>
							Open Full Playground →
						</Link>
					</div>
				</div>
			</section>

			{/* Providers Section */}
			<section className="px-4 py-16 bg-fd-muted/20">
				<div className="max-w-6xl mx-auto">
					<h2 className="text-3xl font-bold text-center mb-4">
						Works with Your Analytics Stack
					</h2>
					<p className="text-center text-fd-muted-foreground mb-12 max-w-2xl mx-auto">
						Official support for popular providers, plus easy custom provider
						integration
					</p>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						<Link
							href="/docs/providers/posthog"
							className="p-6 rounded-lg border border-fd-border bg-fd-card hover:border-fd-primary transition-colors group"
						>
							<div className="flex items-center gap-3 mb-2">
								<img
									src="https://favicon.vemetric.com/posthog.com?size=32"
									alt="PostHog"
									className="w-6 h-6"
								/>
								<h3 className="text-lg font-semibold">PostHog</h3>
							</div>
							<p className="text-sm text-fd-muted-foreground">
								Product analytics with feature flags and session replay
							</p>
						</Link>

						<Link
							href="/docs/providers/bento"
							className="p-6 rounded-lg border border-fd-border bg-fd-card hover:border-fd-primary transition-colors group"
						>
							<div className="flex items-center gap-3 mb-2">
								<img
									src="https://favicon.vemetric.com/bentonow.com?size=32"
									alt="Bento"
									className="w-6 h-6"
								/>
								<h3 className="text-lg font-semibold">Bento</h3>
							</div>
							<p className="text-sm text-fd-muted-foreground">
								Email marketing and automation with event tracking
							</p>
						</Link>

						<Link
							href="/docs/providers/pirsch"
							className="p-6 rounded-lg border border-fd-border bg-fd-card hover:border-fd-primary transition-colors group"
						>
							<div className="flex items-center gap-3 mb-2">
								<img
									src="https://favicon.vemetric.com/pirsch.io?size=32"
									alt="Pirsch"
									className="w-6 h-6"
								/>
								<h3 className="text-lg font-semibold">Pirsch</h3>
							</div>
							<p className="text-sm text-fd-muted-foreground">
								Privacy-focused, cookie-free web analytics
							</p>
						</Link>

						<Link
							href="/docs/providers/custom"
							className="p-6 rounded-lg border border-fd-border bg-fd-card hover:border-fd-primary transition-colors group"
						>
							<div className="flex items-center gap-3 mb-2">
								<div className="w-6 h-6 rounded bg-fd-muted flex items-center justify-center text-xs font-bold">
									+
								</div>
								<h3 className="text-lg font-semibold">Custom</h3>
							</div>
							<p className="text-sm text-fd-muted-foreground">
								Create providers for any analytics service
							</p>
						</Link>
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="px-4 py-20 bg-gradient-to-b from-fd-muted/20 to-fd-background">
				<div className="max-w-3xl mx-auto text-center space-y-6">
					<h2 className="text-4xl font-bold">Ready to Get Started?</h2>
					<p className="text-xl text-fd-muted-foreground">
						Install trakoo and start tracking type-safe events in
						minutes
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
						<Link
							href="/docs/quick-start"
							className="inline-flex items-center justify-center px-8 py-3 text-base font-medium rounded-lg bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 transition-colors"
						>
							Quick Start Guide
						</Link>
						<Link
							href="/docs/core-concepts"
							className="inline-flex items-center justify-center px-8 py-3 text-base font-medium rounded-lg border border-fd-border bg-fd-background hover:bg-fd-muted transition-colors"
						>
							Learn Core Concepts
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}
