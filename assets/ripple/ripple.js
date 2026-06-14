(function () {
    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function parseDurationMs(raw, fallback) {
        const value = String(raw || "").trim();
        if (!value) return fallback;
        if (value.endsWith("ms")) return Number.parseFloat(value) || fallback;
        if (value.endsWith("s")) return (Number.parseFloat(value) || 0) * 1000 || fallback;
        return Number.parseFloat(value) || fallback;
    }

    function parseNumber(raw, fallback) {
        const value = Number.parseFloat(String(raw || "").trim());
        return Number.isFinite(value) ? value : fallback;
    }

    function parseRgb(raw, fallback) {
        const values = String(raw || "").match(/[\d.]+/g)?.map((value) => Number.parseFloat(value));
        if (!values || values.length < 3) return fallback;
        return [
            clamp(values[0], 0, 255),
            clamp(values[1], 0, 255),
            clamp(values[2], 0, 255),
        ];
    }

    function rippleWidthFromPoint(width, height, offsetX, offsetY) {
        const maxX = Math.max(offsetX, width - offsetX);
        const maxY = Math.max(offsetY, height - offsetY);
        return Math.sqrt(maxX * maxX + maxY * maxY) * 2;
    }

    function startSparkles(canvas, ripple, rippleWidth, rgb, opacityLevel1, opacityLevel2, maxCount) {
        const context = canvas.getContext("2d");
        if (!context) return () => {};

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rippleWidth * pixelRatio));
        canvas.height = Math.max(1, Math.floor(rippleWidth * pixelRatio));
        context.scale(pixelRatio, pixelRatio);

        const [r, g, b] = rgb;
        const rings = [];
        let frameId = 0;
        let running = true;

        const draw = () => {
            if (!running) return;

            const nowRadius = ripple.clientWidth / 2;
            const baseRadius = ripple.clientWidth / 2.6;
            const size = rippleWidth;
            const center = size / 2;
            const compression = 6;
            const divergence = nowRadius;

            context.clearRect(0, 0, size, size);

            if (nowRadius > 0) {
                const sparkleCount = Math.min(Math.max(1, Math.floor(ripple.clientWidth)), maxCount);
                const dots = [];
                for (let index = 0; index < sparkleCount; index += 1) {
                    const angle = Math.random() * Math.PI * 2;
                    const spread = divergence / compression;
                    const x = Math.cos(angle) * baseRadius + (Math.floor(Math.random() * spread) - Math.floor(Math.random() * spread));
                    const y = Math.sin(angle) * baseRadius + (Math.floor(Math.random() * spread) - Math.floor(Math.random() * spread));
                    dots.push({ x, y });
                }

                const alpha = Math.abs((Math.random() - Math.random()) * 0.3 + (1 - nowRadius / rippleWidth) - (1 - 0.6));
                rings.push({ dots, alpha: clamp(alpha, 0, 1) });

                if (rings.length > 5) {
                    rings.splice(0, rings.length - 5);
                    if (rings[0]) rings[0].alpha = clamp(opacityLevel1, 0, 1);
                    if (rings[1]) rings[1].alpha = clamp(opacityLevel2, 0, 1);
                }

                for (const ring of rings) {
                    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${ring.alpha.toFixed(3)})`;
                    for (const dot of ring.dots) {
                        context.fillRect(center + dot.x, center + dot.y, 1, 1);
                    }
                }
            }

            frameId = window.requestAnimationFrame(draw);
        };

        frameId = window.requestAnimationFrame(draw);
        return () => {
            running = false;
            window.cancelAnimationFrame(frameId);
            context.clearRect(0, 0, rippleWidth, rippleWidth);
        };
    }

    function handleRipple(event, target) {
        if (!target) return;

        const rect = target.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const rawRippleWidth = rippleWidthFromPoint(rect.width, rect.height, offsetX, offsetY);
        if (!rawRippleWidth || !Number.isFinite(rawRippleWidth)) return;

        const computed = window.getComputedStyle(target);
        const rippleColorRaw = computed.getPropertyValue("--ripple-color").trim();
        const fallbackRgb = parseRgb(computed.color, [255, 255, 255]);
        const rippleColor = rippleColorRaw || `rgba(${fallbackRgb[0]}, ${fallbackRgb[1]}, ${fallbackRgb[2]}, 0.21)`;
        const sparkleRgb = parseRgb(computed.getPropertyValue("--ripple-sparkle-rgb").trim(), [255, 255, 255]);

        const rippleExpandDuration = parseDurationMs(computed.getPropertyValue("--ripple-duration"), 400);
        const rippleFadeDuration = parseDurationMs(computed.getPropertyValue("--ripple-fade-duration"), 200);
        const rippleWaitBeforeFade = parseDurationMs(computed.getPropertyValue("--ripple-wait-before-fade"), 290);
        const sparkleFadeDuration = parseDurationMs(computed.getPropertyValue("--ripple-sparkle-duration"), 600);
        const sparklesMaxCount = Math.max(1, Math.floor(parseNumber(computed.getPropertyValue("--ripple-sparkles-max-count"), 2048)));
        const opacityLevel1 = clamp(parseNumber(computed.getPropertyValue("--ripple-sparkles-opacity-level1"), 0.2), 0, 1);
        const opacityLevel2 = clamp(parseNumber(computed.getPropertyValue("--ripple-sparkles-opacity-level2"), 0.1), 0, 1);
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (computed.position === "static") {
            target.style.position = "relative";
        }

        const rippleWidth = rawRippleWidth / 0.8;
        const layer = document.createElement("span");
        layer.className = "ripple-layer";

        const ripple = document.createElement("span");
        ripple.className = "ripple-node";
        ripple.style.left = `${offsetX}px`;
        ripple.style.top = `${offsetY}px`;
        ripple.style.width = `${rippleWidth}px`;
        ripple.style.height = `${rippleWidth}px`;
        layer.append(ripple);

        let stopSparkles = () => {};
        if (!prefersReducedMotion) {
            const sparkles = document.createElement("canvas");
            sparkles.className = "ripple-sparkles";
            sparkles.style.left = `${offsetX}px`;
            sparkles.style.top = `${offsetY}px`;
            sparkles.style.width = `${rippleWidth}px`;
            sparkles.style.height = `${rippleWidth}px`;
            layer.append(sparkles);

            stopSparkles = startSparkles(
                sparkles,
                ripple,
                rippleWidth,
                sparkleRgb,
                opacityLevel1,
                opacityLevel2,
                sparklesMaxCount,
            );

            sparkles.animate(
                { opacity: [1, 0] },
                { fill: "forwards", duration: sparkleFadeDuration },
            );
        }

        target.append(layer);

        const rippleAnim = ripple.animate(
            {
                width: [`${rippleWidth / 6}px`, `${rippleWidth}px`],
                height: [`${rippleWidth / 6}px`, `${rippleWidth}px`],
                background: [
                    `radial-gradient(circle closest-side, ${rippleColor} 0%, transparent)`,
                    `radial-gradient(circle closest-side, ${rippleColor} 80%, transparent)`,
                ],
            },
            {
                fill: "forwards",
                duration: rippleExpandDuration,
                easing: "cubic-bezier(0,0.49,0,1)",
            },
        );

        let finished = false;
        const cleanup = () => {
            if (finished) return;
            finished = true;
            stopSparkles();
            layer.remove();
            window.removeEventListener("pointerup", beginFade, true);
            window.removeEventListener("pointercancel", beginFade, true);
        };

        const beginFade = async () => {
            if (finished) return;
            const elapsed = Number(rippleAnim.currentTime || 0);
            if (elapsed < rippleWaitBeforeFade) {
                await new Promise((resolve) => window.setTimeout(resolve, rippleWaitBeforeFade - elapsed));
            } else {
                try {
                    await rippleAnim.finished;
                } catch {
                }
            }

            if (finished) return;
            await ripple.animate(
                { opacity: [1, 0] },
                { fill: "forwards", duration: rippleFadeDuration, easing: "cubic-bezier(0.11, 0, 0.5, 0)" },
            ).finished.catch(() => undefined);

            cleanup();
        };

        window.addEventListener("pointerup", beginFade, true);
        window.addEventListener("pointercancel", beginFade, true);
        window.setTimeout(beginFade, rippleExpandDuration + rippleFadeDuration + 80);
    }

    function handleDelegatedRipple(event) {
        if (!(event.target instanceof Element)) return;
        const target = event.target.closest(".ripple-target");
        if (!target) return;
        handleRipple(event, target);
    }

    window.VibeClownRipple = {
        handleDelegatedRipple,
    };
})();
