import AVKit
import Photos
import UIKit

/** What the viewer tells whoever opened it; see MmsViewerPlugin. */
protocol PhotoViewerDelegate: AnyObject {
    func viewer(_ viewer: PhotoViewerController, didShow index: Int)
    func viewerDidClose(_ viewer: PhotoViewerController)
    func viewer(_ viewer: PhotoViewerController, action: String, item: String)
    func viewer(_ viewer: PhotoViewerController, react target: String, kind: String?)
    func viewer(_ viewer: PhotoViewerController, post body: String, item: String, request: String)
    func viewer(_ viewer: PhotoViewerController, remove comment: String, request: String)
    func viewer(_ viewer: PhotoViewerController, needsVideo item: String)
}

/**
 * A trip's photos, full screen, the way Photos shows them.
 *
 * Swipe sideways to page, pinch or double-tap to zoom, double-tap and hold to
 * zoom with one thumb, swipe down to put the photo away. A single tap hides the
 * bars. The bars are the system's own, so on iOS 26 they are Liquid Glass: the
 * way out and the date on top with the menu beside it, comments and likes at
 * the bottom with the count between them.
 */
final class PhotoViewerController: UIViewController, UIPageViewControllerDataSource,
    UIPageViewControllerDelegate, UIGestureRecognizerDelegate {
    private(set) var items: [ViewerItem]
    private(set) var index: Int
    let labels: ViewerLabels
    let source: ViewerSource
    private weak var delegate: PhotoViewerDelegate?

    private var states: [String: ViewerState] = [:]
    /** Playback addresses by item, once the page has handed one over. */
    private var videoURLs: [String: URL] = [:]
    private var askedVideo = Set<String>()

    private let backdrop = UIView()
    private let pages = UIPageViewController(
        transitionStyle: .scroll, navigationOrientation: .horizontal, options: [.interPageSpacing: 16])
    private let topShade = ShadeView(fromTop: true)
    private let bottomShade = ShadeView(fromTop: false)
    private let note = NoteView()
    private let counter = UILabel()
    private var chromeHidden = false
    private var leaving = false
    /** Set when the page closes the viewer itself: it already knows. */
    private var silent = false
    private var commentsWanted = false
    private weak var comments: CommentsController?

    private lazy var closeItem: UIBarButtonItem = {
        let item = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.close()
        })
        item.accessibilityLabel = labels.close
        return item
    }()
    private lazy var moreItem: UIBarButtonItem = {
        let item = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: nil)
        item.accessibilityLabel = labels.more
        return item
    }()
    private lazy var commentsButton: UIButton = {
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: "bubble.left")
        config.imagePadding = 6
        config.baseForegroundColor = .label
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
            self?.openComments()
        })
        button.accessibilityLabel = labels.comments
        return button
    }()
    private lazy var reactButton: UIButton = {
        var config = UIButton.Configuration.plain()
        config.imagePadding = 6
        config.baseForegroundColor = .label
        let button = UIButton(configuration: config)
        button.showsMenuAsPrimaryAction = true
        return button
    }()
    private lazy var commentsItem = UIBarButtonItem(customView: commentsButton)
    private lazy var reactItem = UIBarButtonItem(customView: reactButton)
    private lazy var counterItem: UIBarButtonItem = {
        let item = UIBarButtonItem(customView: counter)
        if #available(iOS 26.0, *) { item.hidesSharedBackground = true }
        return item
    }()

    private var current: PhotoPageController? { pages.viewControllers?.first as? PhotoPageController }
    private var currentItem: ViewerItem? { items.indices.contains(index) ? items[index] : nil }

    init(items: [ViewerItem], index: Int, labels: ViewerLabels, source: ViewerSource, delegate: PhotoViewerDelegate) {
        self.items = items
        self.index = index
        self.labels = labels
        self.source = source
        self.delegate = delegate
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: Showing and leaving

    /**
     * Over the page rather than instead of it: while the photo is swiped away
     * the trip shows through behind it, as it does in Photos.
     */
    func present(from host: UIViewController, withComments: Bool) {
        let nav = UINavigationController(rootViewController: self)
        nav.modalPresentationStyle = .overFullScreen
        nav.modalPresentationCapturesStatusBarAppearance = true
        nav.overrideUserInterfaceStyle = .dark
        nav.view.backgroundColor = .clear
        nav.setToolbarHidden(false, animated: false)
        if #unavailable(iOS 26.0) {
            // Before Liquid Glass a bar is a slab; over a photo it should be
            // nothing but its buttons, on the shade below it.
            let bar = UINavigationBarAppearance()
            bar.configureWithTransparentBackground()
            nav.navigationBar.standardAppearance = bar
            nav.navigationBar.scrollEdgeAppearance = bar
            nav.navigationBar.compactAppearance = bar
            let tools = UIToolbarAppearance()
            tools.configureWithTransparentBackground()
            nav.toolbar.standardAppearance = tools
            nav.toolbar.scrollEdgeAppearance = tools
        }
        nav.view.alpha = 0
        commentsWanted = withComments
        host.present(nav, animated: false) {
            self.current?.content.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
            UIView.animate(
                withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.3, delay: 0,
                usingSpringWithDamping: 1, initialSpringVelocity: 0, options: [.allowUserInteraction]
            ) {
                nav.view.alpha = 1
                self.current?.content.transform = .identity
            }
            if self.commentsWanted, self.states[self.currentItem?.id ?? ""]?.comments != nil {
                self.commentsWanted = false
                self.openComments()
            }
        }
    }

    /** Down and out with a fade, then the page is told. */
    func close() {
        guard !leaving else { return }
        leaving = true
        let nav = navigationController
        let finish = {
            UIView.animate(
                withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, delay: 0,
                options: [.curveEaseIn, .beginFromCurrentState]
            ) {
                nav?.view.alpha = 0
                self.current?.content.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
            } completion: { _ in
                self.dismissFully()
            }
        }
        if let sheet = nav?.presentedViewController {
            sheet.dismiss(animated: true) { finish() }
        } else {
            finish()
        }
    }

    /** At once and without a word: the page closed it. */
    func closeNow() {
        silent = true
        leaving = true
        current?.pause()
        navigationController?.presentingViewController?.dismiss(animated: false)
    }

    private func dismissFully() {
        current?.pause()
        let host = navigationController?.presentingViewController
        host?.dismiss(animated: false) {
            if !self.silent { self.delegate?.viewerDidClose(self) }
        }
    }

    override var prefersStatusBarHidden: Bool { chromeHidden }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    // MARK: Layout

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        backdrop.backgroundColor = .black
        backdrop.frame = view.bounds
        backdrop.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(backdrop)

        addChild(pages)
        pages.view.frame = view.bounds
        pages.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        pages.view.backgroundColor = .clear
        view.addSubview(pages.view)
        pages.didMove(toParent: self)
        pages.dataSource = self
        pages.delegate = self
        pages.setViewControllers([makePage(index)], direction: .forward, animated: false)

        for shade in [topShade, bottomShade] {
            shade.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(shade)
        }
        note.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(note)
        NSLayoutConstraint.activate([
            topShade.topAnchor.constraint(equalTo: view.topAnchor),
            topShade.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topShade.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topShade.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 72),
            bottomShade.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bottomShade.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomShade.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomShade.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -72),
            note.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            note.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            note.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
        ])

        counter.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        counter.textColor = .secondaryLabel
        counter.layer.shadowColor = UIColor.black.cgColor
        counter.layer.shadowOpacity = 0.5
        counter.layer.shadowRadius = 4
        counter.layer.shadowOffset = .zero

        navigationItem.leftBarButtonItem = closeItem
        if #unavailable(iOS 26.0) {
            navigationItem.titleView = TitleView()
        }

        let swipe = UIPanGestureRecognizer(target: self, action: #selector(swiped(_:)))
        swipe.delegate = self
        view.addGestureRecognizer(swipe)

        updateChrome()
        warmNeighbours()
    }

    // MARK: From the page

    func replace(items newItems: [ViewerItem], index newIndex: Int?) {
        guard !newItems.isEmpty else { return }
        let same = newItems.map(\.id) == items.map(\.id)
        let wanted = min(max(newIndex ?? index, 0), newItems.count - 1)
        items = newItems
        if !same || wanted != index {
            index = wanted
            pages.setViewControllers([makePage(index)], direction: .forward, animated: false)
            updateChrome()
            warmNeighbours()
        }
    }

    func apply(_ state: ViewerState) {
        states[state.id] = state
        guard state.id == currentItem?.id else { return }
        updateChrome()
        comments?.show(item: state.id, comments: state.comments)
        if commentsWanted, state.comments != nil, navigationController?.view.window != nil {
            commentsWanted = false
            openComments()
        }
    }

    func videoURL(_ url: URL?, for id: String) {
        guard let url else { return }
        videoURLs[id] = url
        for case let page as PhotoPageController in pages.viewControllers ?? [] where page.item.id == id {
            page.attach(AVPlayer(url: url))
        }
    }

    func showNote(_ text: String?, busy: Bool) {
        note.show(text, busy: busy)
    }

    func finished(request: String, error: String?) {
        comments?.finished(request: request, error: error)
    }

    func share(_ urls: [URL], completion: @escaping (Bool) -> Void) {
        let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, completed, _, _ in completion(completed) }
        sheet.popoverPresentationController?.barButtonItem = moreItem
        let presenter = navigationController?.presentedViewController ?? navigationController ?? self
        presenter.present(sheet, animated: true)
    }

    // MARK: For the pages

    fileprivate func toggleChrome() {
        setChrome(hidden: !chromeHidden)
    }

    private func setChrome(hidden: Bool) {
        guard hidden != chromeHidden else { return }
        chromeHidden = hidden
        navigationController?.setNavigationBarHidden(hidden, animated: true)
        navigationController?.setToolbarHidden(hidden, animated: true)
        UIView.animate(withDuration: 0.25) {
            self.topShade.alpha = hidden ? 0 : 1
            self.bottomShade.alpha = hidden ? 0 : 1
            self.setNeedsStatusBarAppearanceUpdate()
        }
    }

    fileprivate func wantsVideo(_ item: ViewerItem) -> URL? {
        if let url = videoURLs[item.id] { return url }
        if !askedVideo.contains(item.id) {
            askedVideo.insert(item.id)
            delegate?.viewer(self, needsVideo: item.id)
        }
        return nil
    }

    fileprivate func post(_ body: String, request: String) {
        guard let id = currentItem?.id else { return }
        delegate?.viewer(self, post: body, item: id, request: request)
    }

    fileprivate func remove(comment: String, request: String) {
        delegate?.viewer(self, remove: comment, request: request)
    }

    fileprivate func react(_ target: String, kind: String?) {
        delegate?.viewer(self, react: target, kind: kind)
    }

    // MARK: The bars

    private func updateChrome() {
        guard let item = currentItem else { return }
        let state = states[item.id]
        let title = state?.title ?? ""
        if #available(iOS 26.0, *) {
            navigationItem.title = title
            navigationItem.subtitle = state?.subtitle
        } else {
            (navigationItem.titleView as? TitleView)?.set(title: title, subtitle: state?.subtitle)
        }

        let actions = (state?.actions ?? []).map { action in
            UIAction(title: action.title, image: UIImage(systemName: action.symbol)) { [weak self] _ in
                guard let self else { return }
                self.delegate?.viewer(self, action: action.id, item: item.id)
            }
        }
        moreItem.menu = UIMenu(children: actions)
        navigationItem.rightBarButtonItem = actions.isEmpty ? nil : moreItem

        counter.text = "\(index + 1) / \(items.count)"
        counter.sizeToFit()

        var tools: [UIBarButtonItem] = []
        if let comments = state?.comments {
            var config = commentsButton.configuration
            config?.title = comments.button
            commentsButton.configuration = config
            commentsButton.accessibilityLabel = comments.title
            commentsButton.sizeToFit()
            tools.append(commentsItem)
        }
        tools.append(.flexibleSpace())
        tools.append(counterItem)
        tools.append(.flexibleSpace())
        if let reactions = state?.reactions {
            var config = reactButton.configuration
            if let emoji = labels.emoji(reactions.mine) {
                config?.image = nil
                config?.title = reactions.total > 0 ? "\(emoji) \(reactions.total)" : emoji
            } else {
                config?.image = UIImage(systemName: "heart")
                config?.title = reactions.total > 0 ? "\(reactions.total)" : nil
            }
            reactButton.configuration = config
            reactButton.accessibilityLabel = reactions.mine == nil ? labels.like : labels.change
            reactButton.menu = reactionMenu(item: item.id, reactions: reactions)
            reactButton.sizeToFit()
            tools.append(reactItem)
        }
        // Without comments the likes would sit alone on one side; with neither,
        // the count stays in the middle.
        if state?.comments == nil, state?.reactions != nil {
            tools.insert(.fixedSpace(44), at: 0)
        } else if state?.comments != nil, state?.reactions == nil {
            tools.append(.fixedSpace(44))
        }
        setToolbarItems(tools, animated: false)
    }

    /** The five to pick from in one row, and who gave what underneath. */
    private func reactionMenu(item: String, reactions: ViewerReactions) -> UIMenu {
        let picks = labels.reactions.map { reaction in
            UIAction(
                title: reaction.label, image: EmojiImage.make(reaction.emoji),
                state: reactions.mine == reaction.kind ? .on : .off
            ) { [weak self] _ in
                let kind = reactions.mine == reaction.kind ? nil : reaction.kind
                self?.react(item, kind: kind)
            }
        }
        let row: UIMenu
        if #available(iOS 17.0, *) {
            // A palette keeps all five on one line; the small size fits four
            // and put the fifth on a row of its own.
            row = UIMenu(options: [.displayInline, .displayAsPalette], children: picks)
        } else if #available(iOS 16.0, *) {
            row = UIMenu(options: .displayInline, preferredElementSize: .small, children: picks)
        } else {
            row = UIMenu(options: .displayInline, children: picks)
        }
        guard !reactions.names.isEmpty else { return UIMenu(children: [row]) }
        let names = UIAction(title: reactions.names, attributes: .disabled) { _ in }
        return UIMenu(children: [row, UIMenu(options: .displayInline, children: [names])])
    }

    private func openComments() {
        guard let item = currentItem, let state = states[item.id], state.comments != nil else { return }
        guard comments == nil, let nav = navigationController, nav.presentedViewController == nil else { return }
        let sheet = CommentsController(labels: labels, viewer: self)
        sheet.show(item: item.id, comments: state.comments)
        let wrapper = UINavigationController(rootViewController: sheet)
        wrapper.overrideUserInterfaceStyle = .dark
        if let presentation = wrapper.sheetPresentationController {
            presentation.detents = [.medium(), .large()]
            presentation.prefersGrabberVisible = true
            // The photo stays in reach above it: paging on shows the comments
            // of the next one, the way the page's own viewer keeps them open.
            presentation.largestUndimmedDetentIdentifier = .medium
            presentation.prefersScrollingExpandsWhenScrolledToEdge = false
            // The sheet itself is drawn by the window, outside the viewer's
            // dark controllers: without this it turned white once it grew to
            // full height, under text that was still white.
            if #available(iOS 17.0, *) {
                presentation.traitOverrides.userInterfaceStyle = .dark
            } else {
                presentation.overrideTraitCollection = UITraitCollection(userInterfaceStyle: .dark)
            }
        }
        comments = sheet
        nav.present(wrapper, animated: true)
    }

    // MARK: Paging

    private func makePage(_ i: Int) -> PhotoPageController {
        PhotoPageController(index: i, item: items[i], viewer: self)
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                            viewControllerBefore viewController: UIViewController) -> UIViewController? {
        guard let page = viewController as? PhotoPageController, page.index > 0 else { return nil }
        return makePage(page.index - 1)
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                            viewControllerAfter viewController: UIViewController) -> UIViewController? {
        guard let page = viewController as? PhotoPageController, page.index < items.count - 1 else { return nil }
        return makePage(page.index + 1)
    }

    func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                            previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
        guard completed, let page = current, page.index != index else { return }
        index = page.index
        updateChrome()
        warmNeighbours()
        if let state = states[page.item.id] {
            comments?.show(item: page.item.id, comments: state.comments)
        }
        delegate?.viewer(self, didShow: index)
    }

    private func warmNeighbours() {
        for i in [index + 1, index - 1] where items.indices.contains(i) {
            source.warm(items[i])
        }
    }

    // MARK: Swipe down to put it away

    private var swipeStart: CGPoint = .zero

    func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
        guard let pan = gesture as? UIPanGestureRecognizer, pan.view == view else { return true }
        guard let page = current, !page.isZoomed, !page.isHolding else { return false }
        let v = pan.velocity(in: view)
        return v.y > 0 && v.y > abs(v.x) * 1.5
    }

    func gestureRecognizer(_ gesture: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        false
    }

    @objc private func swiped(_ pan: UIPanGestureRecognizer) {
        guard let content = current?.content, !leaving else { return }
        let t = pan.translation(in: view)
        let progress = min(max(t.y / 420, 0), 1)
        switch pan.state {
        case .began:
            setChrome(hidden: true)
        case .changed:
            let scale = 1 - progress * 0.25
            content.transform = CGAffineTransform(translationX: t.x, y: t.y).scaledBy(x: scale, y: scale)
            backdrop.alpha = 1 - progress
        case .ended, .cancelled:
            let v = pan.velocity(in: view)
            if pan.state == .ended, (t.y > 90 && v.y > -150) || v.y > 900 {
                leaving = true
                UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
                    content.transform = CGAffineTransform(translationX: t.x, y: self.view.bounds.height)
                        .scaledBy(x: 0.75, y: 0.75)
                    self.backdrop.alpha = 0
                    content.alpha = 0
                } completion: { _ in
                    self.dismissFully()
                }
            } else {
                UIView.animate(
                    withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0
                ) {
                    content.transform = .identity
                    self.backdrop.alpha = 1
                }
                setChrome(hidden: false)
            }
        default:
            break
        }
    }
}

// MARK: - One photo or video

final class PhotoPageController: UIViewController {
    let index: Int
    let item: ViewerItem
    private unowned let viewer: PhotoViewerController
    private var zoom: ZoomView?
    private var poster: UIImageView?
    private var waiting: UILabel?
    private var player: AVPlayerViewController?
    private var appeared = false

    init(index: Int, item: ViewerItem, viewer: PhotoViewerController) {
        self.index = index
        self.item = item
        self.viewer = viewer
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /** What moves when the photo is swiped away. */
    var content: UIView { zoom ?? view }
    var isZoomed: Bool { (zoom?.zoomScale ?? 1) > 1.02 }
    var isHolding: Bool { zoom?.isHolding ?? false }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        if item.isVideo {
            showVideo()
        } else {
            showPhoto()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appeared = true
        player?.player?.play()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        appeared = false
        pause()
    }

    func pause() {
        player?.player?.pause()
    }

    private func showPhoto() {
        let zoom = ZoomView(ratio: item.ratio)
        zoom.frame = view.bounds
        zoom.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        zoom.onSingleTap = { [weak self] in self?.viewer.toggleChrome() }
        view.addSubview(zoom)
        self.zoom = zoom
        let source = viewer.source
        if let full = source.cached(item, .full) {
            zoom.show(full)
            return
        }
        if let low = source.cached(item, .low) { zoom.show(low) }
        var sharp = false
        source.image(item, .low) { image in
            if let image, !sharp { zoom.show(image) }
        }
        source.image(item, .full) { image in
            guard let image else { return }
            sharp = true
            zoom.show(image)
        }
    }

    /**
     * Its still first, with a word that it is coming, then the system's own
     * player: scrubbing, AirPlay and picture in picture as anywhere else.
     */
    private func showVideo() {
        let poster = UIImageView(frame: view.bounds)
        poster.contentMode = .scaleAspectFit
        poster.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(poster)
        self.poster = poster
        viewer.source.image(item, .low) { [weak poster] image in poster?.image = image }

        let waiting = UILabel()
        waiting.text = viewer.labels.videoLoading
        waiting.font = .preferredFont(forTextStyle: .subheadline)
        waiting.textColor = .secondaryLabel
        waiting.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(waiting)
        NSLayoutConstraint.activate([
            waiting.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            waiting.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -72),
        ])
        self.waiting = waiting

        if let id = item.asset {
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return }
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true
            PHImageManager.default().requestPlayerItem(forVideo: asset, options: options) { [weak self] playerItem, _ in
                guard let playerItem else { return }
                DispatchQueue.main.async { self?.attach(AVPlayer(playerItem: playerItem)) }
            }
        } else if let url = viewer.wantsVideo(item) {
            attach(AVPlayer(url: url))
        }
    }

    func attach(_ avPlayer: AVPlayer) {
        guard player == nil else { return }
        let controller = AVPlayerViewController()
        controller.player = avPlayer
        controller.videoGravity = .resizeAspect
        controller.view.backgroundColor = .clear
        addChild(controller)
        controller.view.frame = view.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(controller.view)
        controller.didMove(toParent: self)
        player = controller
        waiting?.removeFromSuperview()
        if appeared { avPlayer.play() }
    }
}

// MARK: - Zoom

/**
 * A photo that zooms like one in Photos: pinch, double-tap to 2.5x where you
 * tapped and back, and double-tap and hold, where dragging up zooms in and down
 * zooms out without lifting your thumb.
 */
final class ZoomView: UIScrollView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    private let imageView = UIImageView()
    private let ratio: CGFloat?
    private var fittedFor: CGSize = .zero
    var onSingleTap: (() -> Void)?

    private struct Hold {
        let scale: CGFloat
        /** The spot on the photo under the thumb, in the photo's own points. */
        let spot: CGPoint
        /** Where that spot sits on screen, which it keeps while zooming. */
        let anchor: CGPoint
        let start: CGPoint
        var moved: Bool
    }

    private var hold: Hold?
    var isHolding: Bool { hold != nil }

    init(ratio: CGFloat?) {
        self.ratio = ratio
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 6
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = UIColor(white: 1, alpha: 0.06)
        imageView.layer.cornerRadius = 2
        imageView.clipsToBounds = true
        addSubview(imageView)

        let holdZoom = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        holdZoom.numberOfTapsRequired = 1
        holdZoom.minimumPressDuration = 0
        holdZoom.delegate = self
        addGestureRecognizer(holdZoom)
        panGestureRecognizer.require(toFail: holdZoom)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: holdZoom)
        addGestureRecognizer(tap)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var image: UIImage? { imageView.image }

    func show(_ image: UIImage) {
        imageView.image = image
        imageView.backgroundColor = .clear
        // A sharper rendition of the same photo lands in the same frame; only
        // a photo whose shape was not known is fitted again.
        if ratio == nil {
            fittedFor = .zero
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != fittedFor, bounds.width > 0 {
            fittedFor = bounds.size
            setZoomScale(1, animated: false)
            let shape = ratio ?? imageView.image.map { $0.size.width / max($0.size.height, 1) } ?? 1
            var size = bounds.size
            if size.width / size.height > shape {
                size.width = size.height * shape
            } else {
                size.height = size.width / shape
            }
            imageView.frame = CGRect(origin: .zero, size: size)
            contentSize = size
        }
        center()
    }

    /** Keeps a photo smaller than the screen in the middle of it. */
    private func center() {
        let x = max((bounds.width - contentSize.width) / 2, 0)
        let y = max((bounds.height - contentSize.height) / 2, 0)
        let inset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
        if contentInset != inset { contentInset = inset }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }

    @objc private func tapped() { onSingleTap?() }

    @objc private func held(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began:
            let anchor = g.location(in: self)
            hold = Hold(
                scale: zoomScale,
                spot: g.location(in: imageView),
                anchor: CGPoint(x: anchor.x - contentOffset.x, y: anchor.y - contentOffset.y),
                start: g.location(in: superview),
                moved: false)
        case .changed:
            guard var h = hold else { return }
            let dy = g.location(in: superview).y - h.start.y
            if !h.moved, abs(dy) > 24 {
                h.moved = true
                hold = h
            }
            guard h.moved else { return }
            // Exponential, so the same distance does the same at 1x as at 4x.
            let scale = min(max(h.scale * exp(-dy / 260), minimumZoomScale), maximumZoomScale)
            setZoomScale(scale, animated: false)
            keep(h.spot, at: h.anchor)
        case .ended, .cancelled, .failed:
            guard let h = hold else { return }
            hold = nil
            if !h.moved {
                if zoomScale > 1.02 {
                    setZoomScale(1, animated: true)
                } else {
                    let size = CGSize(width: bounds.width / 2.5, height: bounds.height / 2.5)
                    let rect = CGRect(
                        x: h.spot.x - size.width / 2, y: h.spot.y - size.height / 2,
                        width: size.width, height: size.height)
                    zoom(to: rect, animated: true)
                }
            } else if zoomScale < 1.02 {
                setZoomScale(1, animated: true)
            }
        default:
            break
        }
    }

    /** Scrolls so a spot on the photo sits at a point on the screen. */
    private func keep(_ spot: CGPoint, at anchor: CGPoint) {
        let x = spot.x * zoomScale - anchor.x
        let y = spot.y * zoomScale - anchor.y
        let maxX = max(contentSize.width - bounds.width + contentInset.right, -contentInset.left)
        let maxY = max(contentSize.height - bounds.height + contentInset.bottom, -contentInset.top)
        contentOffset = CGPoint(
            x: min(max(x, -contentInset.left), maxX),
            y: min(max(y, -contentInset.top), maxY))
    }
}

// MARK: - Comments

/**
 * The comments on the photo on screen, in a sheet that leaves the photo in
 * reach above it: what people said, a heart for each, the field to add your
 * own, and a swipe to take back one of yours.
 */
final class CommentsController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextViewDelegate {
    private let labels: ViewerLabels
    private unowned let viewer: PhotoViewerController
    private var item = ""
    private var list: [ViewerComment] = []
    /** The comment being sent; the field waits for it. */
    private var pending: String?
    /** Comments being taken away, which leave the field alone. */
    private var removing = Set<String>()

    private let table = UITableView(frame: .zero, style: .plain)
    private let empty = UILabel()
    private let field = UITextView()
    private let placeholder = UILabel()
    private let send = UIButton(type: .system)
    private let error = UILabel()
    private var fieldHeight: NSLayoutConstraint!

    init(labels: ViewerLabels, viewer: PhotoViewerController) {
        self.labels = labels
        self.viewer = viewer
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        navigationItem.rightBarButtonItem?.accessibilityLabel = labels.commentsClose

        table.backgroundColor = .clear
        table.dataSource = self
        table.delegate = self
        table.separatorStyle = .none
        table.keyboardDismissMode = .interactive
        table.register(CommentCell.self, forCellReuseIdentifier: CommentCell.id)
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)

        empty.text = labels.empty
        empty.textColor = .secondaryLabel
        empty.font = .preferredFont(forTextStyle: .subheadline)
        empty.textAlignment = .center
        empty.numberOfLines = 0
        table.backgroundView = empty

        let composer = UIView()
        composer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(composer)

        field.font = .preferredFont(forTextStyle: .body)
        field.backgroundColor = UIColor(white: 1, alpha: 0.08)
        field.layer.cornerRadius = 18
        field.textContainerInset = UIEdgeInsets(top: 9, left: 10, bottom: 9, right: 10)
        field.delegate = self
        field.translatesAutoresizingMaskIntoConstraints = false
        composer.addSubview(field)

        placeholder.text = labels.placeholder
        placeholder.textColor = .tertiaryLabel
        placeholder.font = field.font
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        field.addSubview(placeholder)

        var config = UIButton.Configuration.filled()
        config.title = labels.post
        config.cornerStyle = .capsule
        send.configuration = config
        send.isEnabled = false
        send.addAction(UIAction { [weak self] _ in self?.submit() }, for: .primaryActionTriggered)
        send.translatesAutoresizingMaskIntoConstraints = false
        send.setContentHuggingPriority(.required, for: .horizontal)
        composer.addSubview(send)

        error.textColor = .systemRed
        error.font = .preferredFont(forTextStyle: .footnote)
        error.numberOfLines = 0
        error.translatesAutoresizingMaskIntoConstraints = false
        composer.addSubview(error)

        fieldHeight = field.heightAnchor.constraint(equalToConstant: 38)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: composer.topAnchor),
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            error.topAnchor.constraint(equalTo: composer.topAnchor, constant: 4),
            error.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 20),
            error.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -20),
            field.topAnchor.constraint(equalTo: error.bottomAnchor, constant: 6),
            field.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 16),
            field.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -10),
            fieldHeight,
            send.leadingAnchor.constraint(equalTo: field.trailingAnchor, constant: 8),
            send.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            send.bottomAnchor.constraint(equalTo: field.bottomAnchor),
            send.heightAnchor.constraint(equalToConstant: 38),
            placeholder.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 15),
            placeholder.topAnchor.constraint(equalTo: field.topAnchor, constant: 9),
        ])
        render(scrollToEnd: true)
    }

    /** The thread of the photo on screen; a new photo starts with an empty field. */
    func show(item id: String, comments: ViewerComments?) {
        let grew = id == item && (comments?.list.count ?? 0) > list.count
        let moved = id != item
        item = id
        title = comments?.title
        list = comments?.list ?? []
        // Before the sheet is on screen there is no field yet; viewDidLoad
        // draws the thread as it is by then.
        guard isViewLoaded else { return }
        if moved {
            field.text = ""
            textViewDidChange(field)
            error.text = nil
        }
        render(scrollToEnd: grew || moved || list.count <= 1)
    }

    func finished(request: String, error message: String?) {
        if removing.remove(request) != nil {
            if let message { error.text = message }
            return
        }
        guard request == pending else { return }
        pending = nil
        send.configuration?.showsActivityIndicator = false
        error.text = message
        if message == nil {
            field.text = ""
        }
        textViewDidChange(field)
    }

    private func render(scrollToEnd: Bool) {
        empty.isHidden = !list.isEmpty
        table.reloadData()
        if scrollToEnd, !list.isEmpty {
            table.scrollToRow(at: IndexPath(row: list.count - 1, section: 0), at: .bottom, animated: false)
        }
    }

    private func submit() {
        let body = field.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, pending == nil else { return }
        let request = UUID().uuidString
        pending = request
        error.text = nil
        send.isEnabled = false
        send.configuration?.showsActivityIndicator = true
        viewer.post(body, request: request)
    }

    func textViewDidChange(_ textView: UITextView) {
        placeholder.isHidden = !textView.text.isEmpty
        let trimmed = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        send.isEnabled = !trimmed.isEmpty && pending == nil
        let fits = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude))
        fieldHeight.constant = min(max(fits.height, 38), 120)
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        (textView.text as NSString).replacingCharacters(in: range, with: text).count <= 2000
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { list.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: CommentCell.id, for: indexPath) as! CommentCell
        let comment = list[indexPath.row]
        cell.fill(comment, labels: labels) { [weak self] in
            self?.viewer.react("c:\(comment.id)", kind: comment.liked ? nil : "heart")
        }
        return cell
    }

    func tableView(_ tableView: UITableView,
                   trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let comment = list[indexPath.row]
        guard comment.canDelete else { return nil }
        let delete = UIContextualAction(style: .destructive, title: labels.delete) { [weak self] _, _, done in
            guard let self else { return done(false) }
            let request = UUID().uuidString
            self.removing.insert(request)
            self.viewer.remove(comment: comment.id, request: request)
            done(true)
        }
        delete.image = UIImage(systemName: "trash")
        return UISwipeActionsConfiguration(actions: [delete])
    }
}

/** One comment: who and when, what they said, and its heart. */
final class CommentCell: UITableViewCell {
    static let id = "comment"
    private let name = UILabel()
    private let badge = UILabel()
    private let time = UILabel()
    private let body = UILabel()
    private let like = UIButton(type: .system)
    private var onLike: (() -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        name.font = .preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
        badge.font = .preferredFont(forTextStyle: .caption2)
        badge.textColor = .secondaryLabel
        time.font = .preferredFont(forTextStyle: .caption1)
        time.textColor = .secondaryLabel
        body.font = .preferredFont(forTextStyle: .body)
        body.numberOfLines = 0
        like.addAction(UIAction { [weak self] _ in self?.onLike?() }, for: .primaryActionTriggered)
        like.tintColor = .secondaryLabel

        let top = UIStackView(arrangedSubviews: [name, badge, time, UIView()])
        top.spacing = 6
        top.alignment = .firstBaseline
        let text = UIStackView(arrangedSubviews: [top, body])
        text.axis = .vertical
        text.spacing = 3
        let row = UIStackView(arrangedSubviews: [text, like])
        row.alignment = .center
        row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(row)
        like.setContentHuggingPriority(.required, for: .horizontal)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
            row.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func fill(_ comment: ViewerComment, labels: ViewerLabels, onLike: @escaping () -> Void) {
        name.text = comment.name
        badge.text = comment.traveller ? labels.traveller : nil
        badge.isHidden = !comment.traveller
        time.text = comment.time
        body.text = comment.body
        self.onLike = onLike
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: comment.liked ? "heart.fill" : "heart")
        config.title = comment.likes > 0 ? "\(comment.likes)" : nil
        config.imagePadding = 4
        config.baseForegroundColor = comment.liked ? .systemPink : .secondaryLabel
        config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
        like.configuration = config
        like.accessibilityLabel = comment.liked ? labels.unlike : labels.like
        like.accessibilityHint = comment.likedBy.isEmpty ? nil : comment.likedBy
    }
}

// MARK: - Small parts

/** The date, and the place under it, on bars from before Liquid Glass. */
private final class TitleView: UIStackView {
    private let main = UILabel()
    private let sub = UILabel()

    init() {
        super.init(frame: .zero)
        axis = .vertical
        alignment = .center
        main.font = .preferredFont(forTextStyle: .headline)
        main.textColor = .white
        sub.font = .preferredFont(forTextStyle: .caption1)
        sub.textColor = UIColor(white: 1, alpha: 0.75)
        addArrangedSubview(main)
        addArrangedSubview(sub)
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func set(title: String, subtitle: String?) {
        main.text = title
        sub.text = subtitle
        sub.isHidden = subtitle == nil
        sizeToFit()
    }
}

/** A soft dark band behind the bars, so white on a white sky stays readable. */
private final class ShadeView: UIView {
    override class var layerClass: AnyClass { CAGradientLayer.self }

    init(fromTop: Bool) {
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        let gradient = layer as! CAGradientLayer
        let dark = UIColor(white: 0, alpha: 0.42).cgColor
        let clear = UIColor(white: 0, alpha: 0).cgColor
        gradient.colors = fromTop ? [dark, clear] : [clear, dark]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/** A short word over the photo, such as a download that is under way. */
private final class NoteView: UIVisualEffectView {
    private let label = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    init() {
        if #available(iOS 26.0, *) {
            super.init(effect: UIGlassEffect())
            cornerConfiguration = .capsule()
        } else {
            super.init(effect: UIBlurEffect(style: .systemMaterialDark))
            layer.cornerRadius = 18
            clipsToBounds = true
        }
        alpha = 0
        isUserInteractionEnabled = false
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.numberOfLines = 2
        let row = UIStackView(arrangedSubviews: [spinner, label])
        row.spacing = 8
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 9),
            row.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -9),
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ text: String?, busy: Bool) {
        if let text { label.text = text }
        spinner.isHidden = !busy
        if busy { spinner.startAnimating() } else { spinner.stopAnimating() }
        UIView.animate(withDuration: 0.2) { self.alpha = text == nil ? 0 : 1 }
    }
}

/** An emoji as a picture, for a menu row that shows pictures. */
private enum EmojiImage {
    private static var made: [String: UIImage] = [:]

    static func make(_ emoji: String) -> UIImage {
        if let hit = made[emoji] { return hit }
        let size = CGSize(width: 30, height: 30)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            let text = emoji as NSString
            let font = UIFont.systemFont(ofSize: 24)
            let bounds = text.size(withAttributes: [.font: font])
            text.draw(
                at: CGPoint(x: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2),
                withAttributes: [.font: font])
        }.withRenderingMode(.alwaysOriginal)
        made[emoji] = image
        return image
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]])
        return UIFont(descriptor: descriptor, size: 0)
    }
}
