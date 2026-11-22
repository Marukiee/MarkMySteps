// Draws the 1024 px app icon: the MarkMySteps compass on the warm paper colour.
// Run: swift Scripts/make-icon.swift MarkMySteps/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.png"
let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setFillColor(CGColor(srgbRed: 0xFB / 255, green: 0xF7 / 255, blue: 0xF2 / 255, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

// The logo lives in a 24 x 24 box; it fills about 62 percent of the icon.
let scale = CGFloat(size) * 0.62 / 24
let offset = (CGFloat(size) - 24 * scale) / 2
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)
ctx.translateBy(x: offset, y: offset)
ctx.scaleBy(x: scale, y: scale)
ctx.setStrokeColor(CGColor(srgbRed: 0xE8 / 255, green: 0x61 / 255, blue: 0x3C / 255, alpha: 1))
ctx.setLineWidth(2.1)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.addEllipse(in: CGRect(x: 12 - 9.4, y: 12 - 9.4, width: 18.8, height: 18.8))
ctx.strokePath()
ctx.move(to: CGPoint(x: 16.4, y: 7.6))
ctx.addLine(to: CGPoint(x: 13.9, y: 13.9))
ctx.addLine(to: CGPoint(x: 7.6, y: 16.4))
ctx.addLine(to: CGPoint(x: 10.1, y: 10.1))
ctx.closePath()
ctx.strokePath()

let image = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote", out)
