const lazyObserver = new IntersectionObserver(
    function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            const element = entry.target;
            if (element.dataset.src) {
                element.src = element.dataset.src;
                element.onload = function () {
                    element.classList.add('fade-in');
                };
            }
            lazyObserver.unobserve(element);
        });
    },
    {
        rootMargin: '220px'
    }
);

export default lazyObserver;
