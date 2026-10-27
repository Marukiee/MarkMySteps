import Capacitor
import UIKit

/**
 * The date picker on the iPhone: the system's own calendar, in a sheet.
 *
 * The page's calendar is modelled on Android's date dialog, with a coloured
 * header, a grid and two buttons along the bottom, and on the iPhone it looked
 * borrowed. A date field asks here with `pick` instead and gets back the day as
 * 'YYYY-MM-DD', '' when it was cleared, or `cancelled` when the sheet was put
 * away without a choice.
 *
 * Days are passed and kept in UTC: a date field is a day, not a moment, and a
 * day read back in a time zone that just moved its clocks could come back as
 * the one before.
 */
@objc(MmsDatePlugin)
public class MmsDatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsDatePlugin"
    public let jsName = "MmsDate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
    ]

    @objc func pick(_ call: CAPPluginCall) {
        let labels = call.getObject("labels") ?? [:]
        let options = DatePickerController.Options(
            value: call.getString("value") ?? "",
            near: call.getString("near") ?? "",
            title: call.getString("title") ?? "",
            locale: Locale(identifier: (call.getString("locale") ?? "en-GB").replacingOccurrences(of: "-", with: "_")),
            tint: call.getString("tint").flatMap(MmsTabBarPlugin.color(hex:)),
            clear: (call.getBool("allowClear") ?? false) ? labels["clear"] as? String ?? "" : nil,
            cancel: labels["cancel"] as? String ?? "",
            select: labels["select"] as? String ?? "")
        DispatchQueue.main.async {
            guard var top = self.bridge?.viewController else {
                call.reject("No view to show the calendar from")
                return
            }
            while let shown = top.presentedViewController { top = shown }
            let picker = DatePickerController(options) { result in
                switch result {
                case .picked(let day): call.resolve(["value": day])
                case .cleared: call.resolve(["value": ""])
                case .cancelled: call.resolve(["cancelled": true])
                }
            }
            picker.present(from: top)
        }
    }
}

/** One date, picked on the system's calendar in a sheet that fits it. */
final class DatePickerController: UIViewController, UIAdaptivePresentationControllerDelegate {
    struct Options {
        let value: String
        let near: String
        let title: String
        let locale: Locale
        let tint: UIColor?
        /** The words on the clear button, when the field may be emptied. */
        let clear: String?
        let cancel: String
        let select: String
    }

    enum Result {
        case picked(String)
        case cleared
        case cancelled
    }

    private let options: Options
    private var done: ((Result) -> Void)?
    private let picker = UIDatePicker()
    private let clearButton = UIButton(type: .system)
    /** The sheet's height for the calendar as it is laid out now. */
    private var fitted: CGFloat = 0

    private static let utc = TimeZone(identifier: "UTC")!

    private lazy var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = Self.utc
        calendar.locale = options.locale
        // Monday first, as the page's own calendar has it.
        calendar.firstWeekday = 2
        return calendar
    }()

    init(_ options: Options, done: @escaping (Result) -> Void) {
        self.options = options
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func present(from host: UIViewController) {
        let nav = UINavigationController(rootViewController: self)
        if let tint = options.tint { nav.view.tintColor = tint }
        if let sheet = nav.sheetPresentationController {
            if #available(iOS 16.0, *) {
                sheet.detents = [.custom(identifier: .init("fit")) { [weak self] context in
                    let height = self?.fitted ?? 0
                    return min(height > 0 ? height : 520, context.maximumDetentValue)
                }]
            } else {
                sheet.detents = [.medium(), .large()]
            }
            sheet.prefersGrabberVisible = true
        }
        nav.presentationController?.delegate = self
        host.present(nav, animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if #unavailable(iOS 26.0) {
            // On Liquid Glass the sheet is the glass; before that it needs a
            // background of its own.
            view.backgroundColor = .systemBackground
        }
        title = options.title

        // The way out and the way to commit, the way Apple's own sheets have
        // them since iOS 26: a cross on the left, a check on the right.
        let close = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.finish(.cancelled)
        })
        close.accessibilityLabel = options.cancel
        navigationItem.leftBarButtonItem = close
        let select = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            guard let self else { return }
            self.finish(.picked(self.iso(self.picker.date)))
        })
        select.accessibilityLabel = options.select
        navigationItem.rightBarButtonItem = select

        picker.datePickerMode = .date
        picker.preferredDatePickerStyle = .inline
        picker.timeZone = Self.utc
        picker.locale = options.locale
        picker.calendar = calendar
        picker.minimumDate = day("1980-01-01")
        let thisYear = calendar.component(.year, from: Date())
        picker.maximumDate = day("\(thisYear + 10)-12-31")
        // An empty field opens near the date it belongs with (an end date on
        // its start), and otherwise on today.
        picker.date = day(options.value) ?? day(options.near) ?? today()
        picker.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(picker)

        var constraints = [
            picker.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            picker.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            picker.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
        ]
        if let clear = options.clear {
            var config = UIButton.Configuration.plain()
            config.title = clear
            config.baseForegroundColor = .systemRed
            clearButton.configuration = config
            clearButton.addAction(UIAction { [weak self] _ in self?.finish(.cleared) }, for: .primaryActionTriggered)
            clearButton.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(clearButton)
            constraints += [
                clearButton.topAnchor.constraint(equalTo: picker.bottomAnchor, constant: 4),
                clearButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            ]
        }
        NSLayoutConstraint.activate(constraints)
    }

    /** Fits the sheet to the calendar: a month of six weeks is taller than one of five. */
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let bottom = options.clear == nil ? picker.frame.maxY : clearButton.frame.maxY
        let height = ceil(bottom + 12)
        guard abs(height - fitted) > 1, bottom > 0 else { return }
        fitted = height
        if #available(iOS 16.0, *), let sheet = navigationController?.sheetPresentationController {
            sheet.animateChanges { sheet.invalidateDetents() }
        }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        // Swiped down: the same as the cross.
        done?(.cancelled)
        done = nil
    }

    private func finish(_ result: Result) {
        done?(result)
        done = nil
        dismiss(animated: true)
    }

    private func day(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /** Today as it is on this phone's clock, as a day. */
    private func today() -> Date {
        var local = Calendar(identifier: .gregorian)
        local.timeZone = .current
        let parts = local.dateComponents([.year, .month, .day], from: Date())
        return calendar.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day, hour: 12)) ?? Date()
    }

    private func iso(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}
