import SwiftUI

/// A drawn landscape standing in for a cover photo in the demo, so the test
/// shows how a trip with photos looks without anybody's real photos in it.
struct LandscapeView: View {
    let scene: Landscape

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            switch scene {
            case .desert:
                landscape(&ctx, size, sky: [0xE9E4DC, 0xF2D9B3], sun: 0xFFF4DE, sunAlpha: 1, sunAt: CGPoint(x: 0.72, y: 0.3),
                          layers: [(0xB9A58C, 0.55), (0xD8A866, 0.66), (0xC48B45, 0.8), (0x6E7A3E, 0.93)])
            case .sunsetSea:
                landscape(&ctx, size, sky: [0xF7B267, 0xF79D3C, 0xE8763A], sun: 0xFFF0C8, sunAlpha: 1, sunAt: CGPoint(x: 0.66, y: 0.42),
                          layers: [(0x8A4A2A, 0.56)])
                let sea = CGRect(x: 0, y: h * 0.6, width: w, height: h * 0.4)
                ctx.fill(Path(sea), with: .linearGradient(Gradient(colors: [Color(hex: 0xD9822F), Color(hex: 0x6E3B1C)]),
                                                          startPoint: CGPoint(x: 0, y: sea.minY), endPoint: CGPoint(x: 0, y: h)))
                ctx.fill(Path(CGRect(x: w * 0.6, y: h * 0.6, width: w * 0.12, height: h * 0.4)), with: .color(Color(hex: 0xFFE9B0, alpha: 0.4)))
                hills(&ctx, size, color: 0x3B2414, at: 0.86, height: 0.05, waves: 3)
            case .snow:
                landscape(&ctx, size, sky: [0x8FB8DE, 0xCFE3F2], sun: 0xFFFFFF, sunAlpha: 0, sunAt: CGPoint(x: 0.8, y: 0.2),
                          layers: [(0xE9EEF3, 0.55), (0xFFFFFF, 0.7), (0x4F5B66, 0.9)])
            case .coast:
                landscape(&ctx, size, sky: [0x7FB6E6, 0xCDE6F5], sun: 0xFFFBEA, sunAlpha: 1, sunAt: CGPoint(x: 0.2, y: 0.22),
                          layers: [(0x2F7FB0, 0.58)])
                hills(&ctx, size, color: 0xC9A77C, at: 0.7, height: 0.08, waves: 1.6)
                hills(&ctx, size, color: 0x7C8F4E, at: 0.82, height: 0.06, waves: 2.4)
            case .highlands:
                landscape(&ctx, size, sky: [0x9DB4C4, 0xD6E0E4], sun: 0xFFFFFF, sunAlpha: 0, sunAt: CGPoint(x: 0.5, y: 0.2),
                          layers: [(0x7D8C93, 0.5), (0x5E7B5C, 0.64), (0x3F5E43, 0.8), (0x2B3F2D, 0.94)])
            case .fjord:
                landscape(&ctx, size, sky: [0x6E9CC8, 0xBFD7EA], sun: 0xFFFFFF, sunAlpha: 0, sunAt: CGPoint(x: 0.5, y: 0.2),
                          layers: [(0x51656F, 0.42), (0x3A4E46, 0.52)])
                let water = CGRect(x: 0, y: h * 0.62, width: w, height: h * 0.38)
                ctx.fill(Path(water), with: .linearGradient(Gradient(colors: [Color(hex: 0x3E6E8E), Color(hex: 0x1F3F55)]),
                                                            startPoint: CGPoint(x: 0, y: water.minY), endPoint: CGPoint(x: 0, y: h)))
                hills(&ctx, size, color: 0xB34A3A, at: 0.9, height: 0.02, waves: 6)
            case .mountains:
                landscape(&ctx, size, sky: [0x8AA7D6, 0xE0E8F4], sun: 0xFFFFFF, sunAlpha: 1, sunAt: CGPoint(x: 0.75, y: 0.25),
                          layers: [(0x9AA6B8, 0.48), (0x6E7C90, 0.62), (0x465566, 0.8)])
            }
        }
        .accessibilityHidden(true)
    }

    private func landscape(_ ctx: inout GraphicsContext, _ size: CGSize, sky: [UInt32], sun: UInt32, sunAlpha: Double, sunAt: CGPoint, layers: [(UInt32, CGFloat)]) {
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(
            Gradient(colors: sky.map { Color(hex: $0) }), startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))
        let c = CGPoint(x: size.width * sunAt.x, y: size.height * sunAt.y)
        let m = min(size.width, size.height)
        if sunAlpha > 0 {
            let glow = m * 0.45
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - glow, y: c.y - glow, width: glow * 2, height: glow * 2)), with: .radialGradient(
                Gradient(colors: [Color(hex: sun, alpha: 0.55), Color(hex: sun, alpha: 0)]), center: c, startRadius: 0, endRadius: glow))
            let r = m * 0.08
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(Color(hex: sun)))
        }
        for (i, layer) in layers.enumerated() {
            hills(&ctx, size, color: layer.0, at: layer.1, height: 0.07 - CGFloat(i) * 0.012, waves: 1.3 + CGFloat(i) * 0.9)
        }
    }

    /// A band of soft hills from `at` (share of the height) to the bottom.
    private func hills(_ ctx: inout GraphicsContext, _ size: CGSize, color: UInt32, at: CGFloat, height: CGFloat, waves: CGFloat) {
        var path = Path()
        let base = size.height * at
        path.move(to: CGPoint(x: 0, y: size.height))
        let steps = 48
        for i in 0...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let y = base - size.height * height * (0.6 * sin((t * waves + at * 3) * .pi) + 0.4 * sin((t * waves * 2.3 + at * 7) * .pi))
            path.addLine(to: CGPoint(x: size.width * t, y: y))
        }
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.closeSubpath()
        ctx.fill(path, with: .color(Color(hex: color)))
    }
}
