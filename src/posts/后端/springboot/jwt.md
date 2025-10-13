---
title: JWT令牌以及登录验证
date: 2024-05-25 16:32:00
tags: code
category:
  - 工具
  - SpringBoot
order: 3
icon: "/img/jwt.svg"
---

<!--more--->

# JWT令牌

## 二、JWT令牌

### 1、原理

`JSON Web Token（JWT）`是一个开放的行业标准（RFC 7519），它定义了一种简介的、自包含的协议格式，用于在通信双方传递json对象，传递的信息经过数字签名可以被验证和信任。JWT可以使用HMAC算法或使用RSA的公钥/私钥对来签名，防止被篡改。

#### 1) **jwt认证流程：**

<img src="/image\jwt1.png" alt=" " style="zoom:50%;" />

::: tip 优缺点

**优点：**

1. jwt基于json，非常方便解析。
2. 可以在令牌中自定义丰富的内容，易扩展。
3. 通过非对称加密算法及数字签名技术，JWT防止篡改，安全性高。
4. 资源服务使用JWT可不依赖认证服务即可完成授权。

**缺点：** JWT令牌较长，占存储空间比较大。

:::



#### 2) **JWT令牌结构：**

JWT令牌由三部分组成，每部分中间使用点（.）分隔，比如：xxxxx.yyyyy.zzzzz

**Header**
	头部包括令牌的类型（即JWT）及使用的哈希算法（如HMAC SHA256或RSA）
一个例子如下：

下边是Header部分的内容

```
{
	"alg": "HS256",
	"typ": "JWT"
}
```

将上边的内容使用Base64Url编码，得到一个字符串就是JWT令牌的第一部分。

**Payload**
	第二部分是负载，内容也是一个json对象，它是存放有效信息的地方，它可以存放jwt提供的现成字段，比如：iss（签发者）,exp（过期时间戳）, sub（面向的用户）等，也可自定义字段。此部分不建议存放敏感信息，因为此部分可以解码还原原始内容。最后将第二部分负载使用Base64Url编码，得到一个字符串就是JWT令牌的第二部分。
一个例子：

```
{
	"sub": "1234567890",
	"name": "456",
	"admin": true
}
```


**Signature**
第三部分是签名，此部分用于防止jwt内容被篡改。
这个部分使用base64url将前两部分进行编码，编码后使用点（.）连接组成字符串，最后使用header中声明签名算法进行签名。
一个例子：

```
HMACSHA256(
base64UrlEncode(header) + "." +
base64UrlEncode(payload),
secret)

```

`base64UrlEncode(header)`：jwt令牌的第一部分。
`base64UrlEncode(payload)`：jwt令牌的第二部分。
`secret`：签名所使用的密钥。

#### 3) JWT常见的相关问题

（1）Base64 是可逆的， 那JWT 安全吗?

​		Base64编码方式是可逆的，也就是透过编码后发放的Token内容是可以被解析的。一般而言，我们都不建议在有效载荷内放敏感讯息，比如使用者的密码。

（2）JWT Payload 內容可以被伪造吗？

​		JWT中的签名Signature可以防止通过Base64可逆方法回推有效载荷内容并将其修改。因为Signature是经由Header跟Payload一起Base64组成的。

（3）JWT空间及长度问题？

​		JWT Token通常长度不会太小，特别是Stateless JWT Token，把所有的数据都编在Token里，很快的就会超过Cookie的大小（4K）或者是URL长度限制。

（4）JWT失效问题？

		无状态JWT令牌（Stateless JWT Token）发放出去之后，不能通过服务器端让令牌失效，必须等到过期时间过才会失去效用。假设在这之间Token被拦截，或者有权限管理身份的差异造成授权Scope修改，都不能阻止发出去的Token失效并要求使用者重新请求新的Token。
### 2、JWT、Session、Cookie的区别

**相同点**

JWT、Session、Cookie都提供安全的用户身份认证

**不同点**

​	①JWT具有加密签名，Session和cookie没有

​	②JWT无状态，声明存储在客户端，而不是存储在服务端内存。Cookie和Session有状态，存储在服务器内存中。

​	③JWT身份验证在本地，不需要请求查询数据库，减少大量的资源消耗，可以对用户进行多次身份验证。Session和Cookie验证的过程会消耗大量的服务器资源。

​	④Session和Cookie只能用在单个节点的域或者它的子域中有效，第三个节点访问会被禁止，不可跨域。JWT支持跨域认证，能够通过多个节点进行用户认证，就是跨域认证。

::: info

Cookie：保存在客户端，大小有限制，有状态，除非特殊情况客户端每次请求头都会默认带上cookie

Session：保存在服务器，服务器有一定的资源开销，允许第三方调用API接口，不跨域，不实现与第三方共享资源。

Token：保存在客户端，保存在任何地方，无限制，无状态

JWT：加密数据签名，自包含用户信息，减少查询数据库，分担服务器的资源压力，无状态，可以跨域认证。

:::

#### 1) 使用cookie考虑问题

​	①存储在客户端，数据容易被篡改，使用前需要验证合法性

​	②敏感数据一般不存放在cookie，不安全。

​	③使用httpOnly在一定程度上可以提高安全性

​	④存储数据有限制，一般是4KB，减少大数据内存的存储，cookie体积的占用。一个浏览器对一个网站最多存放20个cookie，浏览器一般只允许存放300个cookie。

​	⑤设置正确的domain、path，减少数据传输

​	⑥cookie不可以跨域

​	⑦移动端对cookie支持性不良好，session也是基于cookie实现，移动端一般用token

#### 2)使用session考虑问题

​	①session存储在服务器内存，同时多用户在线，session会占据更多的内存，需要定期去服务端清除过期的session。

​	②sessionid存储在cookie，是连接cookie和session的桥梁。浏览器禁止cookie不支持cookie，需要重写url。session基于cookie实现，但是不一定非要靠cookie才能实现。

​	③网站采用集群部署的时候，多台web服务器之间无法共享session。session是单个服务器创建，处理用户请求不一定是同一台服务器，其他的服务器无法拿到之前放入单个服务器的session登录凭证信息。

​	④session跨域问题，多个应用共享session时候，不同的引用部署在不同的主机，需要在各个应用之间做好cookie跨域处理。

​	⑤移动端对cookie支持性不良好，session基于cookie实现，移动端一般用token

#### 3)使用token考虑问题

​	①token完全由应用管理，所以它可以避开同源策略

​	②token存储在数据库中查询时间过长，可以考虑放在内存中，比如redis

​	③token可以避免CSRF攻击

​	④移动端常用token

#### 4)使用JWT考虑问题

​	①JWT不依赖cookie，使用任何域名提供API服务而不需要担心跨域资源共享问题（CORS）

​	②JWT默认不加密，但也可以加密。生成原始token以后，可以用密钥再次加密。JWT不加密情况不建议把敏感数据放入其中

​	③JWT不仅用于用户登录，也可以用于信息交流。JWT可以减低查询数据库的次数。

​	④优点是服务器不再需要存储session，服务器认证鉴权有更好的可扩展性。

​	⑤缺点是服务器不再需要存储session，无法废弃token或者更改token权限。JWT一旦签发直到过期之前都有效。

​	⑥JWT自包含用户信息，一旦泄漏，任何人都可以盗用令牌的权限。为了减少盗用JWT有效期应该尽量的短。

​	⑦JWT适合签发一次性的命令认证，颁发有限期极短的JWT，减少暴露的危险。每次操作都会生成新的JWT，不需要保存，实现真正的无状态。

​	⑧减少盗用，JWT使用HTTPS传输协议较好，不建议使用HTTP。


### 3、使用

**依赖：**

```xml
		<dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt</artifactId>
            <version>0.9.1</version>
        </dependency>
```

**jwtUtils:**

```java
public class JwtUtils {

    private static String signKey = "ruyiwei";  //签名
    private static Long expire = 43200000L;		//有效时长

    /**
     * 生成JWT令牌
     * @param claims JWT第二部分负载 payload 中存储的内容
     * @return
     */
    public static String generateJwt(Map<String, Object> claims){
        String jwt = Jwts.builder()
                .addClaims(claims)
                .signWith(SignatureAlgorithm.HS256, signKey)
                .setExpiration(new Date(System.currentTimeMillis() + expire))
                .compact();
        return jwt;
    }

    /**
     * 解析JWT令牌
     * @param jwt JWT令牌
     * @return JWT第二部分负载 payload 中存储的内容
     */
    public static Claims parseJWT(String jwt){
        Claims claims = Jwts.parser()
                .setSigningKey(signKey)
                .parseClaimsJws(jwt)
                .getBody();
        return claims;
    }
}
```

**登录校验：**

```java
@PostMapping("/login")
    public Result login(@RequestBody Emp emp){
        log.info("员工登录：{}", emp);
        Emp e = empService.login(emp);

        //登录成功生成并下发令牌
        if(e != null){
            Map<String, Object> claims = new HashMap<>();
            claims.put("id", e.getId());
            claims.put("name", e.getName());
            claims.put("username", e.getUsername());

            String jwt = JwtUtils.generateJwt(claims);
            return Result.success(jwt);
        }
        //登录失败，返回错误信息
        return Result.error("用户名或密码错误");
    }
```





# 参考

[1] [https://blog.csdn.net/a772304419/article/details/132085742](https://blog.csdn.net/a772304419/article/details/132085742)

[2] [https://blog.csdn.net/qq_41895003/article/details/130567062](https://blog.csdn.net/qq_41895003/article/details/130567062)

[3] [https://blog.csdn.net/weixin_45709829/article/details/124003742](https://blog.csdn.net/weixin_45709829/article/details/124003742)

