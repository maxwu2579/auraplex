import { calculateShortages, planIssue, type Material, type ShortageRow, type CalculationProduct } from '..'

function material (code: string, stock: number): Material {
  const result: Partial<Material> = {
    _id: code as Material['_id'],
    normalizedCode: code,
    stock,
    name: code,
    rack: 'A',
    level: '1'
  }
  return result as Material
}
function row (code: string, required: number, status: ShortageRow['status'] = 'enough'): ShortageRow {
  return {
    code,
    name: code,
    required,
    stock: 10,
    shortage: 0,
    status,
    issues: status === 'problem' ? ['数量无效'] : [],
    assumedZero: false,
    rack: 'A',
    level: '1',
    uses: []
  }
}

test('plans all sufficient stock without mutation', () => {
  const stock = [material('A', 10), material('B', 10)]
  const plan = planIssue([row('A', 2), row('B', 3)], stock)
  expect(plan.items.map((item) => [item.quantity, item.delta, item.balance])).toEqual([
    [2, -2, 8],
    [3, -3, 7]
  ])
  expect(plan.blocked).toHaveLength(0)
  expect(stock[0].stock).toBe(10)
})
test('blocks shortages and lists problems separately', () => {
  const plan = planIssue(
    [row('A', 11, 'shortage'), row('B', 1, 'problem'), row('C', 2)],
    [material('A', 10), material('B', 10), material('C', 10)]
  )
  expect(plan.blocked).toHaveLength(1)
  expect(plan.skipped[0].reasons).toEqual(['数量无效'])
  expect(plan.items).toHaveLength(1)
})
test('skips duplicate material codes and duplicated result rows', () => {
  expect(planIssue([row('A', 1)], [material('A', 10), material('Ａ', 10)]).items).toHaveLength(0)
  expect(planIssue([row('A', 1), row('A', 1)], [material('A', 10)]).items).toHaveLength(0)
})
test('skips quantities exceeding three decimal places', () => {
  const plan = planIssue([row('A', 0.0001)], [material('A', 10)])
  expect(plan.items).toHaveLength(0)
  expect(plan.skipped[0].reasons[0]).toContain('3 位小数')
})
test('uses the combined requirement from multiple products and sections', () => {
  const line = (quantity: number, section: string): CalculationProduct['lines'][number] => ({
    code: 'A',
    description: 'A',
    quantity,
    quantityProblem: false,
    codeProblem: false,
    section,
    sourceRow: 1
  })
  const products: CalculationProduct[] = [
    { id: '1', name: 'Product A', count: 2, lines: [line(1, 'one'), line(2, 'two')] },
    { id: '2', name: 'Product B', count: 1, lines: [line(3, 'one')] }
  ]
  const stock = [material('A', 10)]
  const plan = planIssue(calculateShortages(products, stock), stock)
  expect(plan.items[0].quantity).toBe(9)
  expect(plan.items[0].balance).toBe(1)
})
