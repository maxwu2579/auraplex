const http = require('http')
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end()
    return
  }
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'TEST PERSON',
                company: 'TEST COMPANY',
                title: 'Sales',
                mobile: '+65 8888 0000',
                phone: '',
                email: 'prospect@example.test',
                website: 'https://example.test',
                address: 'Test Street',
                country: 'Singapore',
                industry: 'Test'
              })
            }
          }
        ]
      })
    )
  })
})
if (require.main === module) server.listen(8111, '0.0.0.0')
module.exports = server
