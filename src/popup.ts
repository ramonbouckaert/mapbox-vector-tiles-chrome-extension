const links = document.getElementsByTagName('a')

for (let i = 0; i < links.length; i++) {
  const link = links[i]
  link.addEventListener(
    'click',
    function () {
      const url = link.getAttribute('href')
      if (url) {
        chrome.tabs.create({ url })
      }
      return false
    }.bind(link),
  )
}
