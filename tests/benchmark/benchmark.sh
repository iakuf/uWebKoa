# 测试基本GET请求
autocannon -c 100 -d 10 http://localhost:3000/

# 测试返回大数据的GET请求
autocannon -c 100 -d 10 http://localhost:3000/large

# 测试POST请求
autocannon -c 100 -d 10 -m POST -b '{"test":"data"}' -H "Content-Type: application/json" http://localhost:3000/echo

# 参数说明：

# - -c 100 : 并发连接数为100
# - -d 10 : 测试持续10秒
# - -m POST : 使用POST方法
# - -b '{"test":"data"}' : 请求体
# - -H "Content-Type: application/json" : 设置请求头